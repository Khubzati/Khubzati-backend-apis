const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL;
const redis =
  redisUrl && typeof redisUrl === 'string' && redisUrl.length > 0
    ? new Redis(redisUrl)
    : null;

const memoryState = new Map();

const nowMs = () => Date.now();

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
};

const buildDefaultKey = (req, keyPrefix) => {
  const userKey = req.user?.id ? `u:${req.user.id}` : `ip:${getClientIp(req)}`;
  return `${keyPrefix}:${userKey}`;
};

const createRateLimiter = ({
  keyPrefix,
  windowMs,
  maxRequests,
  message = 'Too many requests. Please try again later.',
  keyBuilder,
}) => {
  if (!keyPrefix || !windowMs || !maxRequests) {
    throw new Error('createRateLimiter requires keyPrefix, windowMs and maxRequests');
  }

  return async (req, res, next) => {
    const key = (typeof keyBuilder === 'function'
      ? keyBuilder(req)
      : buildDefaultKey(req, keyPrefix)) || buildDefaultKey(req, keyPrefix);

    try {
      if (redis) {
        const count = await redis.incr(key);
        if (count === 1) {
          await redis.pexpire(key, windowMs);
        }

        if (count > maxRequests) {
          return res.status(429).json({
            status: 'fail',
            message,
          });
        }

        return next();
      }

      const now = nowMs();
      const entry = memoryState.get(key) || { count: 0, windowStart: now };

      if (now - entry.windowStart >= windowMs) {
        entry.count = 0;
        entry.windowStart = now;
      }

      entry.count += 1;
      memoryState.set(key, entry);

      if (entry.count > maxRequests) {
        return res.status(429).json({
          status: 'fail',
          message,
        });
      }

      return next();
    } catch (error) {
      // Do not block requests if limiter backend fails.
      console.error('Rate limiter error:', error.message);
      return next();
    }
  };
};

module.exports = {
  createRateLimiter,
};
