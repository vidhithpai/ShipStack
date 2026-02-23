const User = require('../models/User');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'deploymate-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

async function register(email, password, name) {
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    const err = new Error('User with this email already exists');
    err.statusCode = 400;
    throw err;
  }
  const user = await User.create({ email: email.toLowerCase(), password, name });
  const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  return {
    user: { id: user._id, email: user.email, name: user.name },
    token,
  };
}

async function login(email, password) {
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user) {
    const err = new Error('Invalid email or password');
    err.statusCode = 401;
    throw err;
  }
  const valid = await user.comparePassword(password);
  if (!valid) {
    const err = new Error('Invalid email or password');
    err.statusCode = 401;
    throw err;
  }
  const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  return {
    user: { id: user._id, email: user.email, name: user.name },
    token,
  };
}

module.exports = { register, login };
