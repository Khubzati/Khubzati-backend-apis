const jwt = require("jsonwebtoken");
const { createApiResponse } = require("../utils/responseHandler");
const enMessages = require("../config/messages/en.json");
const arMessages = require("../config/messages/ar.json");
const { User } = require("../db/models");

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Attach user to request object, excluding password
      req.user = await User.findByPk(decoded.userId, {
        attributes: { exclude: ["password_hash"] }
      });

      if (!req.user) {
        return res.status(401).json(createApiResponse(enMessages.UNAUTHORIZED, arMessages.UNAUTHORIZED, { detail: { en: "User not found for this token.", ar: "المستخدم غير موجود لهذا الرمز."}}, false));
      }

      next();
    } catch (error) {
      console.error("Authentication error:", error);
      return res.status(401).json(createApiResponse(enMessages.UNAUTHORIZED, arMessages.UNAUTHORIZED, { detail: { en: "Not authorized, token failed.", ar: "غير مصرح له، فشل الرمز."}}, false));
    }
  }

  if (!token) {
    return res.status(401).json(createApiResponse(enMessages.UNAUTHORIZED, arMessages.UNAUTHORIZED, { detail: { en: "Not authorized, no token.", ar: "غير مصرح له، لا يوجد رمز."}}, false));
  }
};

// Middleware to restrict access to certain roles
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json(createApiResponse(enMessages.FORBIDDEN, arMessages.FORBIDDEN, { detail: { en: `User role ${req.user ? req.user.role : ''} is not authorized to access this route.`, ar: `دور المستخدم ${req.user ? req.user.role : ''} غير مصرح له بالوصول إلى هذا المسار.`}}, false));
    }
    next();
  };
};

module.exports = { protect, authorize };

