const express = require('express');
const deploymentController = require('../controllers/deploymentController');
const { auth } = require('../middleware/auth');

const router = express.Router();
router.use(auth);

router.post('/deploy', deploymentController.deploy);
router.get('/', deploymentController.list);
router.get('/:id/logs', deploymentController.logs);
router.get('/:id/build-logs', deploymentController.buildLogs);
router.get('/:id/stats', deploymentController.stats);
router.get('/:id', deploymentController.getOne);
router.post('/:id/restart', deploymentController.restart);
router.post('/:id/stop', deploymentController.stop);
router.post('/:id/start', deploymentController.start);
router.delete('/:id', deploymentController.remove);

module.exports = router;
