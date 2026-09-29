const crypto = require('crypto');

const requestContext = (req, res, next) => {
  const requestId =
    req.headers['x-request-id']?.toString().trim() || crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
};

module.exports = {
  requestContext,
};
