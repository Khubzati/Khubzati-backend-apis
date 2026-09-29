const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

const getJwtSecrets = () => {
  const directSecrets = [
    process.env.JWT_SECRET,
    process.env.JWT_SECRET_KEY,
    process.env.JWT_SECRET_PREVIOUS,
    process.env.JWT_SECRET_OLD,
  ];
  const rotationSecrets = String(process.env.JWT_SECRET_ROTATION || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const merged = [...directSecrets, ...rotationSecrets]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  if (merged.length === 0 && !isProduction) {
    return ['dev-temp-secret-change-me'];
  }

  return [...new Set(merged)];
};

const getJwtVerifyOptions = () => {
  const algorithms = String(process.env.JWT_ALGORITHMS || 'HS256')
    .split(',')
    .map((algorithm) => algorithm.trim())
    .filter(Boolean);
  const options = { algorithms };
  const issuer = String(process.env.JWT_ISSUER || '').trim();
  const audience = String(process.env.JWT_AUDIENCE || '').trim();
  if (issuer) options.issuer = issuer;
  if (audience) options.audience = audience;
  return options;
};

const verifyTokenWithRotation = (token) => {
  const secrets = getJwtSecrets();
  if (secrets.length === 0) {
    throw new Error('JWT secret configuration is missing');
  }

  let lastError = null;
  for (const secret of secrets) {
    try {
      return jwt.verify(token, secret, getJwtVerifyOptions());
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Token verification failed');
};

// Middleware to authenticate JWT token
const authenticateToken = async (req, res, next) => {
  try {
    // Let CORS preflight requests pass before auth checks.
    if (req.method === 'OPTIONS') {
      return next();
    }

    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN format

    if (!token) {
      return res.status(401).json({
        status: 'fail',
        message: 'Authentication required'
      });
    }

    const decoded = verifyTokenWithRotation(token);
    if (!decoded?.id || !decoded?.role) {
      return res.status(403).json({
        status: 'fail',
        message: 'Invalid token payload',
      });
    }
    const currentUser = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, role: true, deletedAt: true, isVerified: true },
    });
    if (!currentUser || currentUser.deletedAt) {
      return res.status(401).json({ status: 'fail', message: 'Session revoked' });
    }
    if (currentUser.role !== decoded.role) {
      return res.status(403).json({ status: 'fail', message: 'Session role is no longer valid' });
    }
    if (['admin', 'customer', 'driver'].includes(currentUser.role) && !currentUser.isVerified) {
      return res.status(403).json({ status: 'fail', message: 'Account is inactive' });
    }
    if (currentUser.role === 'bakery_owner' || currentUser.role === 'restaurant_owner') {
      const selectedVendorId = String(req.headers['x-vendor-id'] || '').trim();
      const delegate = currentUser.role === 'bakery_owner' ? prisma.bakery : prisma.restaurant;
      const vendor = await delegate.findFirst({
        where: {
          ownerId: currentUser.id,
          deletedAt: null,
          ...(selectedVendorId ? { id: selectedVendorId } : {}),
        },
        select: { status: true },
      });
      if (vendor?.status === 'suspended') {
        return res.status(403).json({ status: 'fail', message: 'Vendor account is suspended' });
      }
    }
    req.user = { ...decoded, role: currentUser.role };
    return next();
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      return res.status(401).json({
        status: 'fail',
        message: 'Token expired'
      });
    }
    if (error?.name === 'JsonWebTokenError' || error?.name === 'NotBeforeError') {
      return res.status(403).json({
        status: 'fail',
        message: 'Invalid or expired token'
      });
    }
    console.error('Authentication error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred during authentication'
    });
  }
};

// Optional auth middleware:
// - If token is missing or invalid, continue as anonymous user.
// - If token is valid, attach decoded user to req.user.
const authenticateTokenOptional = (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return next();
    }

    try {
      const decoded = verifyTokenWithRotation(token);
      if (decoded?.id && decoded?.role) {
        req.user = decoded;
      }
    } catch (_) {
      // Keep anonymous flow for optional auth middleware.
    }
    return next();
  } catch (_error) {
    return next();
  }
};

// Middleware to check user role
const authorizeRole = (roles) => {
  return (req, res, next) => {
    if (req.method === 'OPTIONS') {
      return next();
    }

    if (!req.user) {
      return res.status(401).json({
        status: 'fail',
        message: 'Authentication required'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        status: 'fail',
        message: 'You do not have permission to perform this action'
      });
    }

    next();
  };
};

module.exports = {
  authenticateToken,
  authenticateTokenOptional,
  authorizeRole
};
