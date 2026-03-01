/**
 * Global error handler - never leak stack traces in production.
 */
function errorHandler(err, req, res, next) {
  // eslint-disable-next-line no-console
  console.error(err);
  const status = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  const isDev = process.env.NODE_ENV !== 'production';
  res.status(status).json({
    message,
    ...(isDev && err.stack && { stack: err.stack }),
  });
}

module.exports = errorHandler;
