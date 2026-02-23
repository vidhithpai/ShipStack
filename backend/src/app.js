require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { cleanupStaleFailedDeployments } = require('./services/deploymentService');
const authRoutes = require('./routes/authRoutes');
const deploymentRoutes = require('./routes/deploymentRoutes');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/deploymate';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/deployments', deploymentRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use(errorHandler);

async function start() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB connected');
    app.listen(PORT, () => {
      console.log(`DeployMate backend listening on port ${PORT}`);
      const maxAgeHours = parseInt(process.env.CLEANUP_FAILED_HOURS || '6', 10);
      const intervalMs = parseInt(process.env.CLEANUP_INTERVAL_MS || String(60 * 60 * 1000), 10);
      setInterval(() => {
        cleanupStaleFailedDeployments({ maxAgeHours }).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('Background cleanup failed', err);
        });
      }, intervalMs);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();
