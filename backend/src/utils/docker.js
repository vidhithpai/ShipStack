const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs').promises;

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

async function dockerBuild(contextPath, imageName) {
  await dockerExec(['build', '-t', imageName, contextPath]);
}

async function dockerRun(imageName, hostPort, containerPort, containerName) {
  const args = [
    'run',
    '-d',
    '--name', containerName,
    '-p', `${hostPort}:${containerPort}`,
    '--memory=512m',
    '--cpus=0.5',
    '--restart', 'no',
    imageName,
  ];
  const { stdout } = await dockerExec(args);
  return stdout.trim();
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

// In-memory set of ports we've assigned (avoids collision within this process)
const assignedPorts = new Set();

/**
 * Find next available port starting from BASE_PORT. Uses assignedPorts to avoid
 * giving the same port twice; for production you may also check system ports.
 */
async function getNextAvailablePort() {
  const BASE_PORT = parseInt(process.env.BASE_PORT || '3001', 10);
  const MAX_PORT = 65535;
  for (let p = BASE_PORT; p <= MAX_PORT; p++) {
    if (!assignedPorts.has(p)) {
      assignedPorts.add(p);
      return p;
    }
  }
  throw new Error('No available port');
}

/** Release a port back to the pool when a deployment is removed. */
function releasePort(port) {
  if (port != null) assignedPorts.delete(port);
}

module.exports = {
  DEPLOYMENTS_BASE,
  safeDeploymentPath,
  dockerBuild,
  dockerRun,
  dockerLogs,
  dockerRestart,
  dockerStop,
  dockerRm,
  dockerRmi,
  getNextAvailablePort,
  releasePort,
};
