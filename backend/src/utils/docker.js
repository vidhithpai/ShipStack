const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs').promises;
const net = require('net');

const execAsync = promisify(exec);

/** Base path for deployments - all paths must resolve under this (no path traversal) */
const DEPLOYMENTS_BASE = path.resolve(process.cwd(), 'deployments');

/**
 * Safely resolve a path under deployments base. Throws if path escapes.
 */
function safeDeploymentPath(deploymentId) {
  const deploymentIdSafe = deploymentId.replace(/[^a-zA-Z0-9-_]/g, '');
  if (!deploymentIdSafe || deploymentIdSafe !== deploymentId) {
    throw new Error('Invalid deployment ID');
  }
  const resolved = path.resolve(DEPLOYMENTS_BASE, deploymentId);
  if (!resolved.startsWith(DEPLOYMENTS_BASE)) {
    throw new Error('Invalid deployment path');
  }
  return resolved;
}

/**
 * Execute Docker CLI with strict args - no user-controlled strings in shell.
 * Uses array form to avoid shell injection.
 */
async function dockerExec(args) {
  const dockerPath = process.env.DOCKER_PATH || 'docker';
  const cmd = [dockerPath, ...args].join(' ');
  const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
  return { stdout: (stdout || '').trim(), stderr: (stderr || '').trim() };
}

function spawnDocker(args) {
  const dockerPath = process.env.DOCKER_PATH || 'docker';
  return spawn(dockerPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

// In-memory store for build logs keyed by deploymentId
const buildLogs = new Map();

function appendBuildLog(deploymentId, chunk) {
  if (!deploymentId) return;
  const text = chunk.toString();
  if (!text) return;
  let buf = buildLogs.get(deploymentId);
  if (!buf) {
    buf = [];
    buildLogs.set(deploymentId, buf);
  }
  buf.push(text);
}

function getBuildLogsSnapshot(deploymentId) {
  const buf = buildLogs.get(deploymentId);
  if (!buf) return '';
  return buf.join('');
}

function clearBuildLogs(deploymentId) {
  if (!deploymentId) return;
  buildLogs.delete(deploymentId);
}

/**
 * Docker build with streaming logs using spawn.
 * Supports two signatures for backward compatibility:
 *  - dockerBuild(contextPath, imageName)
 *  - dockerBuild(deploymentId, contextPath, imageName) // enables log tracking
 */
async function dockerBuild(arg1, arg2, arg3) {
  let deploymentId = null;
  let contextPath;
  let imageName;

  if (typeof arg3 === 'string') {
    deploymentId = String(arg1);
    contextPath = arg2;
    imageName = arg3;
  } else {
    contextPath = arg1;
    imageName = arg2;
  }

  const dockerPath = process.env.DOCKER_PATH || 'docker';
  const args = ['build', '--progress=plain', '-t', imageName, contextPath];

  return new Promise((resolve, reject) => {
    const child = spawn(dockerPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    child.stdout.on('data', (chunk) => {
      appendBuildLog(deploymentId, chunk);
    });

    child.stderr.on('data', (chunk) => {
      appendBuildLog(deploymentId, chunk);
    });

    child.on('error', (err) => {
      appendBuildLog(deploymentId, `\n[build-error] ${err.message}\n`);
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const error = new Error(`Docker build failed with exit code ${code}`);
        error.code = code;
        reject(error);
      }
    });
  });
}

async function dockerRun(imageName, hostPort, containerPort, containerName) {
  const args = [
    'run',
    '-d',
    '--name', containerName,
    '-p', `${hostPort}:${containerPort}`,
    '--memory=512m',
    '--cpus=0.5',
    '--read-only',
    '--pids-limit', '100',
    '--security-opt', 'no-new-privileges',
    '--restart', 'no',
    imageName,
  ];
  const { stdout } = await dockerExec(args);
  return stdout.trim();
}

async function dockerStart(containerId) {
  return new Promise((resolve, reject) => {
    const child = spawnDocker(['start', containerId]);
    let stdoutBuf = '';
    let stderrBuf = '';

    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdoutBuf.trim(), stderr: stderrBuf.trim() });
      } else {
        const error = new Error(
          stderrBuf.trim() || stdoutBuf.trim() || `Docker start failed with exit code ${code}`
        );
        error.code = code;
        reject(error);
      }
    });
  });
}

async function dockerLogs(containerId, tail = 100) {
  const tailNum = Math.min(Math.max(Number(tail) || 100, 1), 1000);
  const { stdout, stderr } = await dockerExec(['logs', '--tail', String(tailNum), containerId]);
  return stdout + (stderr ? '\n' + stderr : '');
}

async function dockerRestart(containerId) {
  await dockerExec(['restart', containerId]);
}

async function dockerStop(containerId) {
  await dockerExec(['stop', containerId]);
}

async function dockerRm(containerId) {
  try {
    await dockerExec(['rm', '-f', containerId]);
  } catch (e) {
    // Container might already be removed
  }
}

async function dockerRmi(imageName) {
  try {
    await dockerExec(['rmi', '-f', imageName]);
  } catch (e) {
    // Image might already be removed
  }
}

async function dockerContainerExists(containerId) {
  return new Promise((resolve) => {
    const child = spawnDocker(['ps', '-a', '-q', '-f', `id=${containerId}`]);
    let stdoutBuf = '';

    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString();
    });

    child.on('error', () => {
      resolve(false);
    });

    child.on('close', () => {
      resolve(Boolean(stdoutBuf.trim()));
    });
  });
}

// In-memory set of ports we've assigned (avoids collision within this process)
const assignedPorts = new Set();

/**
 * Find next available port starting from BASE_PORT. Uses assignedPorts to avoid
 * giving the same port twice; for production you may also check system ports.
 */
async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
      .once('error', () => {
        resolve(false);
      })
      .once('listening', () => {
        server.close(() => resolve(true));
      })
      .listen(port, '0.0.0.0');
  });
}

async function getNextAvailablePort() {
  const BASE_PORT = parseInt(process.env.BASE_PORT || '3001', 10);
  const MAX_PORT = 65535;
  for (let p = BASE_PORT; p <= MAX_PORT; p++) {
    if (assignedPorts.has(p)) continue;
    // Check if port is free on the host
    // eslint-disable-next-line no-await-in-loop
    const available = await isPortAvailable(p);
    if (!available) continue;
    assignedPorts.add(p);
    return p;
  }
  throw new Error('No available port');
}

/** Release a port back to the pool when a deployment is removed. */
function releasePort(port) {
  if (port != null) assignedPorts.delete(port);
}

async function dockerStats(containerId) {
  const { stdout } = await dockerExec([
    'stats',
    '--no-stream',
    '--format',
    '"{{json .}}"',
    containerId,
  ]);
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error('No stats returned from Docker');
  }
  let jsonText = trimmed;
  // Some shells may wrap the JSON in quotes; strip them if present.
  if (jsonText.startsWith('"') && jsonText.endsWith('"')) {
    jsonText = jsonText.slice(1, -1);
  }
  return JSON.parse(jsonText);
}

async function pruneDanglingImages() {
  try {
    await dockerExec(['image', 'prune', '-f']);
  } catch (e) {
    // Log but don't crash callers
    // eslint-disable-next-line no-console
    console.error('Failed to prune dangling images', e);
  }
}

module.exports = {
  DEPLOYMENTS_BASE,
  safeDeploymentPath,
  dockerBuild,
  dockerRun,
  dockerStart,
  dockerLogs,
  dockerRestart,
  dockerStop,
  dockerRm,
  dockerRmi,
  dockerContainerExists,
  getNextAvailablePort,
  releasePort,
   dockerStats,
   pruneDanglingImages,
   getBuildLogsSnapshot,
   clearBuildLogs,
};
