const { createApiResponse } = require("../utils/responseHandler");
const enMessages = require("../config/messages/en.json");
const arMessages = require("../config/messages/ar.json");
const { User } = require("../db/models");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
// const crypto = require("crypto"); // For generating secure tokens for password reset/email verification
// const sendEmail = require("../utils/emailService"); // Placeholder for an email sending utility

exports.register = async (req, res) => {
  try {
    const { username, email, password, full_name, phone_number, role } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json(createApiResponse(
        enMessages.VALIDATION_ERROR,
        arMessages.VALIDATION_ERROR,
        null,
        false,
        [{
          field: "username, email, password",
          message: {
            en: "Username, email, and password are required.",
            ar: "اسم المستخدم والبريد الإلكتروني وكلمة المرور مطلوبة."
          }
        }]
      ));
    }

    const existingUserByEmail = await User.findOne({ where: { email } });
    if (existingUserByEmail) {
      return res.status(400).json(createApiResponse(
        enMessages.REGISTRATION_ERROR,
        arMessages.REGISTRATION_ERROR,
        null,
        false,
        [{
          field: "email",
          message: {
            en: "User with this email already exists.",
            ar: "المستخدم بهذا البريد الإلكتروني موجود بالفعل."
          }
        }]
      ));
    }

    const existingUserByUsername = await User.findOne({ where: { username } });
    if (existingUserByUsername) {
      return res.status(400).json(createApiResponse(
        enMessages.REGISTRATION_ERROR,
        arMessages.REGISTRATION_ERROR,
        null,
        false,
        [{
          field: "username",
          message: {
            en: "User with this username already exists.",
            ar: "المستخدم باسم المستخدم هذا موجود بالفعل."
          }
        }]
      ));
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newUser = await User.create({
      username,
      email,
      password_hash: hashedPassword,
      full_name,
      phone_number,
      role: role || "customer",
      is_verified: false // Email verification will be a separate step
    });

    // TODO: Send verification email
    // const verificationToken = crypto.randomBytes(32).toString("hex");
    // newUser.emailVerificationToken = verificationToken;
    // newUser.emailVerificationExpires = Date.now() + 3600000; // 1 hour
    // await newUser.save();
    // await sendEmail(newUser.email, "Verify your email", `Token: ${verificationToken}`);

    const userResponse = newUser.toJSON();
    delete userResponse.password_hash;

    return res.status(201).json(createApiResponse(
      enMessages.REGISTRATION_SUCCESS, // Message should ideally state that verification email is sent
      arMessages.REGISTRATION_SUCCESS, // "تم تسجيل المستخدم بنجاح. يرجى التحقق من بريدك الإلكتروني لتفعيل حسابك."
      { user: userResponse },
      true
    ));

  } catch (error) {
    console.error("Registration error:", error);
    if (error.name === "SequelizeValidationError") {
      const validationErrors = error.errors.map(err => ({
        field: err.path,
        message: {
          en: err.message,
          ar: `خطأ في التحقق من صحة الحقل: ${err.path}`
        }
      }));
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, validationErrors));
    }
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json(createApiResponse(
        enMessages.VALIDATION_ERROR,
        arMessages.VALIDATION_ERROR,
        null,
        false,
        [{
          field: "email, password",
          message: {
            en: "Email and password are required.",
            ar: "البريد الإلكتروني وكلمة المرور مطلوبان."
          }
        }]
      ));
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json(createApiResponse(enMessages.LOGIN_ERROR, arMessages.LOGIN_ERROR, null, false));
    }

    // TODO: Check if user is verified if email verification is mandatory for login
    // if (!user.is_verified) {
    //   return res.status(401).json(createApiResponse(enMessages.LOGIN_ERROR_NOT_VERIFIED, arMessages.LOGIN_ERROR_NOT_VERIFIED, null, false));
    // }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json(createApiResponse(enMessages.LOGIN_ERROR, arMessages.LOGIN_ERROR, null, false));
    }

    user.last_login = new Date();
    await user.save();

    const token = jwt.sign(
      { userId: user.user_id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "1h" }
    );
    // TODO: Implement refresh token strategy
    // const refreshToken = jwt.sign({ userId: user.user_id }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d" });

    const userResponse = user.toJSON();
    delete userResponse.password_hash;

    return res.status(200).json(createApiResponse(
      enMessages.LOGIN_SUCCESS,
      arMessages.LOGIN_SUCCESS,
      { user: userResponse, token /*, refreshToken */ },
      true
    ));

  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

exports.logout = async (req, res) => {
    return res.status(200).json(createApiResponse(enMessages.LOGOUT_SUCCESS, arMessages.LOGOUT_SUCCESS, null, true));
};

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body; // Assuming refresh token is sent in body
    if (!refreshToken) {
        return res.status(400).json(createApiResponse(
            enMessages.VALIDATION_ERROR, 
            arMessages.VALIDATION_ERROR, 
            null, 
            false, 
            [{ field: "refreshToken", message: { en: "Refresh token is required.", ar: "رمز التحديث مطلوب." } }]
        ));
    }
    // TODO: Validate refresh token (e.g., against a database store or by verifying its signature if self-contained)
    // For now, this is a placeholder for actual refresh token logic.
    // const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    // const user = await User.findByPk(decoded.userId);
    // if (!user) { ... }
    // const newAccessToken = jwt.sign({ userId: user.user_id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "1h" });
    
    return res.status(501).json(createApiResponse(
        enMessages.REFRESH_TOKEN_ERROR, 
        arMessages.REFRESH_TOKEN_ERROR, 
        { detail: {en: "Refresh token functionality not fully implemented.", ar: "وظيفة تحديث الرمز المميز لم تنفذ بالكامل بعد." } }, 
        false
    ));
  } catch (error) {
    console.error("Refresh token error:", error);
    // if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
    //     return res.status(401).json(createApiResponse(enMessages.REFRESH_TOKEN_INVALID, arMessages.REFRESH_TOKEN_INVALID, null, false));
    // }
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

exports.requestPasswordReset = async (req, res) => {
    // TODO: Implement logic to generate password reset token, save it to user, and send email.
    // 1. Get email from req.body
    // 2. Find user by email
    // 3. If user not found, return appropriate error
    // 4. Generate a secure token (e.g., crypto.randomBytes)
    // 5. Store hashed token and expiry in User model (new fields needed: passwordResetToken, passwordResetExpires)
    // 6. Send email to user with a link containing the token (e.g., /reset-password?token=YOUR_TOKEN)
    return res.status(501).json(createApiResponse(
        enMessages.PASSWORD_RESET_REQUEST_ERROR, 
        arMessages.PASSWORD_RESET_REQUEST_ERROR, 
        { detail: {en: "Request password reset not implemented.", ar: "طلب إعادة تعيين كلمة المرور لم ينفذ بعد." } }, 
        false
    ));
};

exports.resetPassword = async (req, res) => {
    // TODO: Implement logic to verify token and reset password.
    // 1. Get token from req.query or req.body, and newPassword from req.body
    // 2. Find user by passwordResetToken (hashed) and where passwordResetExpires > Date.now()
    // 3. If no user or token expired, return error
    // 4. Hash newPassword
    // 5. Update user's password_hash, clear passwordResetToken and passwordResetExpires
    // 6. Save user
    return res.status(501).json(createApiResponse(
        enMessages.PASSWORD_RESET_ERROR, 
        arMessages.PASSWORD_RESET_ERROR, 
        { detail: {en: "Reset password functionality not implemented.", ar: "وظيفة إعادة تعيين كلمة المرور لم تنفذ بعد." } }, 
        false
    ));
};

exports.verifyEmail = async (req, res) => {
    // TODO: Implement logic to verify email using a token.
    // 1. Get token from req.query or req.body
    // 2. Find user by emailVerificationToken (hashed or plain, depending on storage strategy) and where emailVerificationExpires > Date.now()
    // 3. If no user or token expired, return error
    // 4. Set user.is_verified = true, clear emailVerificationToken and emailVerificationExpires
    // 5. Save user
    return res.status(501).json(createApiResponse(
        enMessages.EMAIL_VERIFY_ERROR, 
        arMessages.EMAIL_VERIFY_ERROR, 
        { detail: {en: "Email verification not implemented.", ar: "التحقق من البريد الإلكتروني لم ينفذ بعد." } }, 
        false
    ));
};

