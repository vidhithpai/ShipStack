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
    containerIds: {
      type: [String],
      default: [],
    },
    serviceNames: {
      type: [String],
      default: [],
    },
    deploymentType: {
      type: String,
      enum: ['generated', 'dockerfile', 'compose'],
      default: 'generated',
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
    frameworkType: {
      type: String,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
    localPath: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

deploymentSchema.statics.Statuses = Object.freeze({
  PENDING: 'pending',
  BUILDING: 'building',
  RUNNING: 'running',
  FAILED: 'failed',
  STOPPED: 'stopped',
  DELETED: 'deleted',
});

module.exports = mongoose.model('Deployment', deploymentSchema);
