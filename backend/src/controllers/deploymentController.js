const deploymentService = require('../services/deploymentService');

async function deploy(req, res, next) {
  try {
    const { repoUrl } = req.body;
    if (!repoUrl) {
      return res.status(400).json({ message: 'repoUrl is required' });
    }
    const deployment = await deploymentService.createDeployment(req.user.id, repoUrl);
    res.status(201).json(deployment);
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const deployments = await deploymentService.getDeploymentsByUser(req.user.id);
    res.json(deployments);
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const deployment = await deploymentService.getDeploymentById(req.params.id, req.user.id);
    if (!deployment) {
      return res.status(404).json({ message: 'Deployment not found' });
    }
    res.json(deployment);
  } catch (err) {
    next(err);
  }
}

async function logs(req, res, next) {
  try {
    const deployment = await deploymentService.getDeploymentById(req.params.id, req.user.id);
    if (!deployment) {
      return res.status(404).json({ message: 'Deployment not found' });
    }
    const tail = parseInt(req.query.tail, 10) || 100;
    const logOutput = await deploymentService.getLogs(req.params.id, req.user.id, tail);
    res.json({ logs: logOutput });
  } catch (err) {
    next(err);
  }
}

async function restart(req, res, next) {
  try {
    const deployment = await deploymentService.restartDeployment(req.params.id, req.user.id);
    if (!deployment) {
      return res.status(404).json({ message: 'Deployment not found' });
    }
    res.json(deployment);
  } catch (err) {
    next(err);
  }
}

async function stop(req, res, next) {
  try {
    const deployment = await deploymentService.stopDeployment(req.params.id, req.user.id);
    if (!deployment) {
      return res.status(404).json({ message: 'Deployment not found' });
    }
    res.json(deployment);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const result = await deploymentService.deleteDeployment(req.params.id, req.user.id);
    if (!result) {
      return res.status(404).json({ message: 'Deployment not found' });
    }
    res.json({ message: 'Deployment deleted' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  deploy,
  list,
  getOne,
  logs,
  restart,
  stop,
  remove,
};
