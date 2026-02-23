const mongoose = require('mongoose');

const deploymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    repoUrl: {
      type: String,
      required: true,
    },
    stackType: {
      type: String,
      enum: ['node', 'python', 'java-maven'],
      required: true,
    },
    imageName: {
      type: String,
      required: true,
    },
    containerId: {
      type: String,
      default: null,
    },
    assignedPort: {
      type: Number,
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'building', 'running', 'stopped', 'failed', 'deleted'],
      default: 'pending',
    },
    localPath: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Deployment', deploymentSchema);
