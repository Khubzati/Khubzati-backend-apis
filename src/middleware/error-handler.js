const { validationResult } = require('express-validator');
const { PrismaClient } = require('../generated/prisma');

const prisma = new PrismaClient();

// Global error handler middleware
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Default error status and message
  let statusCode = 500;
  let message = 'Internal server error';

  // Handle specific error types
  if (err.name === 'PrismaClientKnownRequestError') {
    // Handle Prisma specific errors
    switch (err.code) {
      case 'P2002': // Unique constraint violation
        statusCode = 400;
        message = `Unique constraint violation on field: ${err.meta?.target?.join(', ')}`;
        break;
      case 'P2003': // Foreign key constraint violation
        statusCode = 400;
        message = 'Foreign key constraint violation';
        break;
      case 'P2025': // Record not found
        statusCode = 404;
        message = 'Record not found';
        break;
      default:
        statusCode = 400;
        message = 'Database error';
    }
  } else if (err.name === 'PrismaClientValidationError') {
    statusCode = 400;
    message = 'Validation error in database query';
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  } else if (err.statusCode) {
    statusCode = err.statusCode;
    message = err.message;
  }

  res.status(statusCode).json({
    status: 'error',
    message
  });
};

// Validation error handler middleware
const validationErrorHandler = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      status: 'fail',
      message: 'Validation error',
      errors: errors.array()
    });
  }
  next();
};

// Not found handler middleware
const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    status: 'fail',
    message: `Route not found: ${req.originalUrl}`
  });
};

// Async handler to catch errors in async route handlers
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  errorHandler,
  validationErrorHandler,
  notFoundHandler,
  asyncHandler
};
