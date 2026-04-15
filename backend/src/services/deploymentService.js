const path = require('path');
const fs = require('fs').promises;
const http = require('http');
const simpleGit = require('simple-git');
const { v4: uuidv4 } = require('uuid');
const Deployment = require('../models/Deployment');
const { validateAndSanitizeGitHubUrl } = require('../utils/githubUrlValidator');
const {
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
  DEPLOYMENTS_BASE,
  dockerStats,
  pruneDanglingImages,
  getBuildLogsSnapshot,
  clearBuildLogs,
  dockerStart,
  dockerContainerExists,
  dockerComposeUp,
  dockerComposeStop,
  dockerComposeDown,
  dockerComposeServiceNames,
  dockerComposeContainerIds,
  dockerComposeLogs,
  dockerComposePort,
} = require('../utils/docker');

// Resolve templates from repo root (backend/src/services -> 3 levels up = deploymate)
const TEMPLATES_DIR = path.resolve(__dirname, '..', '..', '..', 'templates');
const INTERNAL_PORT = process.env.INTERNAL_PORT || 3000;

/**
 * For Node projects, parse package.json safely, enforce a start script,
 * and detect common frameworks.
 */
async function detectNodeStack(packageJsonPath) {
  let raw;
  try {
    raw = await fs.readFile(packageJsonPath, 'utf8');
  } catch (e) {
    throw new Error('Failed to read package.json');
  }

  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch (e) {
    throw new Error('Malformed package.json');
  }

  const scripts = pkg.scripts || {};
  if (!scripts.start) {
    throw new Error('No start script found in package.json');
  }

  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };

  let frameworkType = null;
  if (deps.next) {
    frameworkType = 'nextjs';
  } else if (deps.express) {
    frameworkType = 'express';
  } else if (deps['@nestjs/core'] || deps.nestjs) {
    frameworkType = 'nestjs';
  }

  return { stackType: 'node', frameworkType };
}

/**
 * Detect project stack from cloned repo path.
 * Returns { stackType, frameworkType } or null.
 */
async function detectStack(repoPath) {
  const packageJsonPath = path.join(repoPath, 'package.json');
  try {
    await fs.access(packageJsonPath);
    return detectNodeStack(packageJsonPath);
  } catch {
    // no package.json, fall through to other stacks
  }

  try {
    await fs.access(path.join(repoPath, 'pom.xml'));
    return { stackType: 'java-maven', frameworkType: null };
  } catch {
    // not a Maven project
  }

  try {
    await fs.access(path.join(repoPath, 'requirements.txt'));
    return { stackType: 'python', frameworkType: null };
  } catch {
    // not a Python project
  }

  return null;
}

/**
 * Load template and inject PORT. Template may use {{PORT}} placeholder.
 */
async function generateDockerfile(stackType, port) {
  const templatePath = path.join(TEMPLATES_DIR, `${stackType}.template`);
  let content;
  try {
    content = await fs.readFile(templatePath, 'utf8');
  } catch (e) {
    throw new Error(`Template not found for stack: ${stackType}`);
  }
  return content.replace(/\{\{PORT\}\}/g, String(port));
}

/**
 * Ensure deployments base dir exists.
 */
async function ensureDeploymentsDir() {
  await fs.mkdir(DEPLOYMENTS_BASE, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function performHttpHealthCheck(port) {
  const timeoutMs = parseInt(process.env.HEALTHCHECK_TIMEOUT_MS || '4000', 10);
  const pathToCheck = process.env.HEALTHCHECK_PATH || '/';

  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path: pathToCheck,
        timeout: timeoutMs,
      },
      (res) => {
        // Consider any 2xx/3xx as healthy
        if (res.statusCode && res.statusCode < 500) {
          res.resume();
          resolve();
        } else {
          const err = new Error(`Health check failed with status ${res.statusCode}`);
          res.resume();
          reject(err);
        }
      }
    );

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy(new Error('Health check timed out'));
    });
  });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectDeploymentType(projectPath) {
  const composeYamlPath = path.join(projectPath, 'docker-compose.yml');
  const composeYmlAltPath = path.join(projectPath, 'docker-compose.yaml');
  const hasComposeYml = await fileExists(composeYamlPath);
  const hasComposeYaml = await fileExists(composeYmlAltPath);
  if (hasComposeYml || hasComposeYaml) {
    return {
      deploymentType: 'compose',
      composeFilePath: hasComposeYml ? composeYamlPath : composeYmlAltPath,
    };
  }

  const dockerfilePath = path.join(projectPath, 'Dockerfile');
  if (await fileExists(dockerfilePath)) {
    return { deploymentType: 'dockerfile', composeFilePath: null };
  }

  return { deploymentType: 'generated', composeFilePath: null };
}

async function validateComposeSecurity(composeFilePath) {
  const raw = await fs.readFile(composeFilePath, 'utf8');
  const lower = raw.toLowerCase();

  if (/^\s*privileged\s*:\s*true\s*$/im.test(lower)) {
    throw new Error('Unsafe docker-compose configuration detected');
  }
  if (/^\s*network_mode\s*:\s*["']?host["']?\s*$/im.test(lower)) {
    throw new Error('Unsafe docker-compose configuration detected');
  }

  // Reject obvious host root mounts in short/long volume syntaxes.
  if (/^\s*-\s*["']?\/\s*:[^#\n]+$/im.test(raw) || /^\s*source\s*:\s*["']?\/\s*$/im.test(raw)) {
    throw new Error('Unsafe docker-compose configuration detected');
  }
}

function parseHostPort(portOutput) {
  if (!portOutput) return null;
  const firstLine = String(portOutput).split(/\r?\n/).find(Boolean);
  if (!firstLine) return null;
  const match = firstLine.match(/:(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

async function resolveComposeHttpPort(projectPath, serviceNames) {
  const preferredPorts = [
    parseInt(process.env.INTERNAL_PORT || '3000', 10),
    80,
    8080,
    8000,
    5000,
  ];

  for (const serviceName of serviceNames) {
    for (const containerPort of preferredPorts) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const mapped = await dockerComposePort(projectPath, serviceName, containerPort);
        const hostPort = parseHostPort(mapped);
        if (hostPort) {
          return hostPort;
        }
      } catch (_) {
        // Keep probing known web ports; not every service exposes one.
      }
    }
  }

  return null;
}

/**
 * Full deployment flow: validate URL, clone, prioritize compose/dockerfile, then fallback to generated Dockerfile.
 */
async function createDeployment(userId, repoUrlInput) {
  const repoUrl = validateAndSanitizeGitHubUrl(repoUrlInput);
  await ensureDeploymentsDir();

  const deploymentId = uuidv4();
  const deploymentPath = safeDeploymentPath(deploymentId);
  const imageName = `deploymate-${deploymentId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const containerName = `deploymate-${deploymentId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  const deployment = await Deployment.create({
    userId,
    repoUrl,
    stackType: 'node', // placeholder, updated after detect
    imageName,
    status: Deployment.Statuses.PENDING,
    localPath: deploymentPath,
  });

  try {
    // Clone repository (no user input in args - URL already validated)
    deployment.status = Deployment.Statuses.BUILDING;
    deployment.errorMessage = null;
    await deployment.save();

    const git = simpleGit();
    await git.clone(repoUrl, deploymentPath, ['--depth', '1']);

    // Ensure a basic .dockerignore exists to keep images small and safe
    const dockerignorePath = path.join(deploymentPath, '.dockerignore');
    try {
      await fs.access(dockerignorePath);
    } catch {
      const dockerignoreContent = ['node_modules', '.git', '.env', '.gitignore'].join('\n');
      await fs.writeFile(dockerignorePath, dockerignoreContent, 'utf8');
    }

    const { deploymentType, composeFilePath } = await detectDeploymentType(deploymentPath);
    deployment.deploymentType = deploymentType;
    deployment.frameworkType = null;
    await deployment.save();

    if (deploymentType === 'compose') {
      // Compose deployment must skip stack detection entirely.
      await validateComposeSecurity(composeFilePath);
      await dockerComposeUp(deploymentPath);

      const serviceNames = await dockerComposeServiceNames(deploymentPath);
      const containerIds = await dockerComposeContainerIds(deploymentPath);
      const assignedPort = await resolveComposeHttpPort(deploymentPath, serviceNames);

      deployment.serviceNames = serviceNames;
      deployment.containerIds = containerIds;
      deployment.containerId = containerIds[0] || null;
      deployment.assignedPort = assignedPort;
      deployment.status = Deployment.Statuses.BUILDING;
      deployment.errorMessage = null;
      await deployment.save();

      // For compose stacks we best-effort check the first exposed HTTP endpoint.
      if (assignedPort) {
        const minWaitMs = parseInt(process.env.HEALTHCHECK_INITIAL_DELAY_MS || '2000', 10);
        await sleep(minWaitMs);
        await performHttpHealthCheck(assignedPort);
      }
    } else {
      let stackTypeForBuild = deployment.stackType;
      if (deploymentType === 'generated') {
        // Stack detection is only required for generated Dockerfiles.
        const detectedStack = await detectStack(deploymentPath);
        if (!detectedStack || !detectedStack.stackType) {
          throw new Error('Unsupported project: could not detect stack (need package.json, pom.xml, or requirements.txt)');
        }
        stackTypeForBuild = detectedStack.stackType;
        deployment.stackType = detectedStack.stackType;
        deployment.frameworkType = detectedStack.frameworkType || null;
        await deployment.save();

        const dockerfileContent = await generateDockerfile(detectedStack.stackType, INTERNAL_PORT);
        const dockerfilePath = path.join(deploymentPath, 'Dockerfile');
        await fs.writeFile(dockerfilePath, dockerfileContent);
      } else if (deploymentType === 'dockerfile') {
        // Preserve current schema requirement while skipping stack detection.
        stackTypeForBuild = deployment.stackType || 'node';
      }

      await dockerBuild(String(deployment._id), deploymentPath, imageName);

      const assignedPort = await getNextAvailablePort();
      const containerId = await dockerRun(imageName, assignedPort, INTERNAL_PORT, containerName);

      deployment.containerId = containerId;
      deployment.containerIds = containerId ? [containerId] : [];
      deployment.serviceNames = [];
      deployment.stackType = stackTypeForBuild;
      deployment.assignedPort = assignedPort;
      deployment.status = Deployment.Statuses.BUILDING;
      deployment.errorMessage = null;
      await deployment.save();

      // Post-start health check: give the app a short window to boot.
      const minWaitMs = parseInt(process.env.HEALTHCHECK_INITIAL_DELAY_MS || '2000', 10);
      await sleep(minWaitMs);
      await performHttpHealthCheck(assignedPort);
    }

    deployment.status = Deployment.Statuses.RUNNING;
    deployment.errorMessage = null;
    await deployment.save();

    // Build logs can be cleared after a successful deployment if desired
    clearBuildLogs(String(deployment._id));

    return deployment;
  } catch (err) {
    deployment.status = Deployment.Statuses.FAILED;
    deployment.errorMessage = err && err.message ? String(err.message).slice(0, 1000) : 'Deployment failed';
    try {
      await deployment.save();
    } catch (_) {
      // ignore secondary persistence errors during failure handling
    }
    await cleanupDeployment(deployment).catch(() => {});
    clearBuildLogs(String(deployment._id));
    throw err;
  }
}

/**
 * Cleanup: stop container, remove container, remove image, delete folder, (caller removes DB entry if needed).
 */
async function cleanupDeployment(deployment) {
  if (deployment.deploymentType === 'compose' && deployment.localPath) {
    await dockerComposeDown(deployment.localPath).catch(() => {});
  }

  if (Array.isArray(deployment.containerIds) && deployment.containerIds.length > 0) {
    for (const containerId of deployment.containerIds) {
      // eslint-disable-next-line no-await-in-loop
      await dockerStop(containerId).catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await dockerRm(containerId).catch(() => {});
    }
  }

  if (deployment.containerId) {
    await dockerStop(deployment.containerId).catch(() => {});
    await dockerRm(deployment.containerId).catch(() => {});
  }
  if (deployment.imageName) {
    await dockerRmi(deployment.imageName).catch(() => {});
  }
  if (deployment.localPath) {
    try {
      await fs.rm(deployment.localPath, { recursive: true, force: true });
    } catch (_) {}
  }
}

async function getLogs(deploymentId, userId, tail) {
  const deployment = await Deployment.findOne({ _id: deploymentId, userId });
  if (!deployment) return null;
  if (deployment.deploymentType === 'compose') {
    if (!deployment.localPath) return '';
    return dockerComposeLogs(deployment.localPath, tail);
  }
  if (!deployment.containerId) return '';
  return dockerLogs(deployment.containerId, tail);
}

async function restartDeployment(deploymentId, userId) {
  const deployment = await Deployment.findOne({ _id: deploymentId, userId });
  if (!deployment) return null;
  if (deployment.deploymentType === 'compose') {
    if (!deployment.localPath) {
      const err = new Error('No compose project path to restart');
      err.statusCode = 400;
      throw err;
    }
    await dockerComposeStop(deployment.localPath);
    await dockerComposeUp(deployment.localPath);
    deployment.containerIds = await dockerComposeContainerIds(deployment.localPath);
    deployment.containerId = deployment.containerIds[0] || null;
    deployment.status = Deployment.Statuses.RUNNING;
    deployment.errorMessage = null;
    await deployment.save();
    return deployment;
  }
  if (!deployment.containerId) {
    const err = new Error('No container to restart');
    err.statusCode = 400;
    throw err;
  }
  await dockerRestart(deployment.containerId);
  deployment.status = Deployment.Statuses.RUNNING;
  deployment.errorMessage = null;
  await deployment.save();
  return deployment;
}

async function stopDeployment(deploymentId, userId) {
  const deployment = await Deployment.findOne({ _id: deploymentId, userId });
  if (!deployment) return null;
  if (deployment.deploymentType === 'compose') {
    if (deployment.localPath) {
      await dockerComposeStop(deployment.localPath);
    }
    deployment.status = Deployment.Statuses.STOPPED;
    deployment.errorMessage = null;
    await deployment.save();
    return deployment;
  }
  if (!deployment.containerId) {
    deployment.status = Deployment.Statuses.STOPPED;
    deployment.errorMessage = null;
    await deployment.save();
    return deployment;
  }
  await dockerStop(deployment.containerId);
  deployment.status = Deployment.Statuses.STOPPED;
  deployment.errorMessage = null;
  await deployment.save();
  return deployment;
}

async function startDeployment(deploymentId, userId) {
  const deployment = await Deployment.findOne({ _id: deploymentId, userId });
  if (!deployment) return null;

  if (deployment.status !== Deployment.Statuses.STOPPED) {
    const err = new Error('Deployment is not in a stopped state');
    err.statusCode = 400;
    throw err;
  }

  if (deployment.deploymentType === 'compose') {
    if (!deployment.localPath) {
      deployment.status = Deployment.Statuses.FAILED;
      deployment.errorMessage = 'Cannot start deployment: compose project path is missing.';
      await deployment.save();
      const err = new Error('Deployment has no compose project path');
      err.statusCode = 400;
      throw err;
    }

    try {
      await dockerComposeUp(deployment.localPath);
      deployment.containerIds = await dockerComposeContainerIds(deployment.localPath);
      deployment.containerId = deployment.containerIds[0] || null;
      deployment.status = Deployment.Statuses.RUNNING;
      deployment.errorMessage = null;
      await deployment.save();
      return deployment;
    } catch (err) {
      deployment.status = Deployment.Statuses.FAILED;
      deployment.errorMessage = err && err.message ? String(err.message).slice(0, 1000) : 'Failed to start compose deployment';
      await deployment.save();
      throw err;
    }
  }

  if (!deployment.containerId) {
    deployment.status = Deployment.Statuses.FAILED;
    deployment.errorMessage = 'Cannot start deployment: containerId is missing.';
    await deployment.save();
    const err = new Error('Deployment has no container to start');
    err.statusCode = 400;
    throw err;
  }

  const exists = await dockerContainerExists(deployment.containerId);
  if (!exists) {
    deployment.status = Deployment.Statuses.FAILED;
    deployment.errorMessage = 'Container no longer exists for this deployment.';
    await deployment.save();
    const err = new Error('Container no longer exists for this deployment');
    err.statusCode = 400;
    throw err;
  }

  try {
    await dockerStart(deployment.containerId);
    deployment.status = Deployment.Statuses.RUNNING;
    deployment.errorMessage = null;
    await deployment.save();
    return deployment;
  } catch (err) {
    deployment.status = Deployment.Statuses.FAILED;
    deployment.errorMessage = err && err.message ? String(err.message).slice(0, 1000) : 'Failed to start container';
    await deployment.save();
    throw err;
  }
}

async function deleteDeployment(deploymentId, userId) {
  const deployment = await Deployment.findOne({ _id: deploymentId, userId });
  if (!deployment) return null;
  await cleanupDeployment(deployment);
  releasePort(deployment.assignedPort);
  await Deployment.findByIdAndDelete(deploymentId);
  clearBuildLogs(String(deployment._id));
  return { deleted: true };
}

async function getBuildLogs(deploymentId, userId) {
  const deployment = await Deployment.findOne({ _id: deploymentId, userId });
  if (!deployment) return null;
  return getBuildLogsSnapshot(String(deployment._id));
}

async function getDeploymentStats(deploymentId, userId) {
  const deployment = await Deployment.findOne({ _id: deploymentId, userId });
  if (!deployment) return null;
  if (!deployment.containerId) {
    const err = new Error('Deployment has no running container');
    err.statusCode = 400;
    throw err;
  }
  const stats = await dockerStats(deployment.containerId);
  return {
    cpuPercent: stats.CPUPerc,
    memoryUsage: stats.MemUsage,
    memoryLimit: stats.MemLimit,
    containerStatus: deployment.status,
  };
}

async function cleanupStaleFailedDeployments({ maxAgeHours = 6 } = {}) {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  const toCleanup = await Deployment.find({
    status: Deployment.Statuses.FAILED,
    updatedAt: { $lt: cutoff },
  });

  // Clean each failed deployment best-effort
  for (const deployment of toCleanup) {
    // eslint-disable-next-line no-await-in-loop
    await cleanupDeployment(deployment).catch(() => {});
    releasePort(deployment.assignedPort);
    // eslint-disable-next-line no-await-in-loop
    await Deployment.findByIdAndDelete(deployment._id).catch(() => {});
    clearBuildLogs(String(deployment._id));
  }

  await pruneDanglingImages();
}

async function getDeploymentsByUser(userId) {
  return Deployment.find({ userId }).sort({ createdAt: -1 }).lean();
}

async function getDeploymentById(deploymentId, userId) {
  return Deployment.findOne({ _id: deploymentId, userId }).lean();
}

module.exports = {
  createDeployment,
  getLogs,
  getBuildLogs,
  restartDeployment,
  stopDeployment,
  startDeployment,
  deleteDeployment,
  getDeploymentsByUser,
  getDeploymentById,
  getDeploymentStats,
  cleanupStaleFailedDeployments,
};
