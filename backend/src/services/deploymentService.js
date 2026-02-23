const path = require('path');
const fs = require('fs').promises;
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
} = require('../utils/docker');

// Resolve templates from repo root (backend/src/services -> 3 levels up = deploymate)
const TEMPLATES_DIR = path.resolve(__dirname, '..', '..', '..', 'templates');
const INTERNAL_PORT = process.env.INTERNAL_PORT || 3000;

/**
 * Detect project stack from cloned repo path. Returns stack type or null.
 */
async function detectStack(repoPath) {
  const checks = [
    { file: 'package.json', stack: 'node' },
    { file: 'pom.xml', stack: 'java-maven' },
    { file: 'requirements.txt', stack: 'python' },
  ];
  for (const { file, stack } of checks) {
    try {
      await fs.access(path.join(repoPath, file));
      return stack;
    } catch {
      // file not found, continue
    }
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

/**
 * Full deployment flow: validate URL, clone, detect stack, generate Dockerfile, build, run, save metadata.
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
    status: 'pending',
    localPath: deploymentPath,
  });

  try {
    // Clone repository (no user input in args - URL already validated)
    deployment.status = 'building';
    await deployment.save();

    const git = simpleGit();
    await git.clone(repoUrl, deploymentPath, ['--depth', '1']);

    const stackType = await detectStack(deploymentPath);
    if (!stackType) {
      throw new Error('Unsupported project: could not detect stack (need package.json, pom.xml, or requirements.txt)');
    }
    deployment.stackType = stackType;
    await deployment.save();

    const dockerfileContent = await generateDockerfile(stackType, INTERNAL_PORT);
    const dockerfilePath = path.join(deploymentPath, 'Dockerfile');
    await fs.writeFile(dockerfilePath, dockerfileContent);

    await dockerBuild(deploymentPath, imageName);

    const assignedPort = await getNextAvailablePort();
    const containerId = await dockerRun(imageName, assignedPort, INTERNAL_PORT, containerName);

    deployment.containerId = containerId;
    deployment.assignedPort = assignedPort;
    deployment.status = 'running';
    await deployment.save();

    return deployment;
  } catch (err) {
    deployment.status = 'failed';
    await deployment.save();
    await cleanupDeployment(deployment).catch(() => {});
    throw err;
  }
}

/**
 * Cleanup: stop container, remove container, remove image, delete folder, (caller removes DB entry if needed).
 */
async function cleanupDeployment(deployment) {
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
  if (!deployment.containerId) return '';
  return dockerLogs(deployment.containerId, tail);
}

async function restartDeployment(deploymentId, userId) {
  const deployment = await Deployment.findOne({ _id: deploymentId, userId });
  if (!deployment) return null;
  if (!deployment.containerId) {
    const err = new Error('No container to restart');
    err.statusCode = 400;
    throw err;
  }
  await dockerRestart(deployment.containerId);
  deployment.status = 'running';
  await deployment.save();
  return deployment;
}

async function stopDeployment(deploymentId, userId) {
  const deployment = await Deployment.findOne({ _id: deploymentId, userId });
  if (!deployment) return null;
  if (!deployment.containerId) {
    deployment.status = 'stopped';
    await deployment.save();
    return deployment;
  }
  await dockerStop(deployment.containerId);
  deployment.status = 'stopped';
  await deployment.save();
  return deployment;
}

async function deleteDeployment(deploymentId, userId) {
  const deployment = await Deployment.findOne({ _id: deploymentId, userId });
  if (!deployment) return null;
  await cleanupDeployment(deployment);
  releasePort(deployment.assignedPort);
  await Deployment.findByIdAndDelete(deploymentId);
  return { deleted: true };
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
  restartDeployment,
  stopDeployment,
  deleteDeployment,
  getDeploymentsByUser,
  getDeploymentById,
};
