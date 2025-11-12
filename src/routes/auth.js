const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('../generated/prisma');
const { sendOTPviaSMS } = require('../services/smsService');

const prisma = new PrismaClient();
const router = express.Router();

const OTP_EXPIRY_MINUTES = 10;

const sanitizeUser = (user) => {
  const { password, otp, otpExpiry, ...userData } = user;
  return userData;
};

const generateOtpCode = () => Math.floor(100000 + Math.random() * 900000).toString();

// Normalize phone number by removing all non-digit characters
const normalizePhoneNumber = (phone) => {
  if (!phone) return null;
  // Remove all non-digit characters
  return phone.toString().replace(/\D/g, '');
};

// Helper function to find user by email, username, or normalized phone
const findUserByIdentifiers = async (emailToCheck, usernameToCheck, phoneToCheck) => {
  try {
    // Build OR conditions for user lookup
    const orConditions = [];

    if (emailToCheck) {
      orConditions.push({ email: emailToCheck });
    }

    if (usernameToCheck) {
      orConditions.push({ username: usernameToCheck });
    }

    let user = null;

    if (phoneToCheck) {
      console.log(`[DEBUG] Looking for user with phone: ${phoneToCheck}`);

      // First try exact match
      if (orConditions.length > 0) {
        orConditions.push({ phoneNumber: phoneToCheck });
        user = await prisma.user.findFirst({
          where: {
            OR: orConditions,
          },
        });
      } else {
        // Only phone number provided
        user = await prisma.user.findFirst({
          where: {
            phoneNumber: phoneToCheck,
          },
        });
      }

      console.log(`[DEBUG] Exact match result: ${user ? 'Found' : 'Not found'}`);

      // If not found, try to find by normalized phone number
      if (!user) {
        try {
          // Generate all possible phone number variations
          const normalizedInput = normalizePhoneNumber(phoneToCheck);
          console.log(`[DEBUG] Normalized input phone: ${normalizedInput}`);

          // Try common phone number variations based on Saudi Arabia format
          const phoneVariations = [];

          // If input is 9 digits, try adding country code
          if (normalizedInput.length === 9) {
            phoneVariations.push(
              `+962${normalizedInput}`,
              `00962${normalizedInput}`,
              `962${normalizedInput}`,
              `0${normalizedInput}`,
              normalizedInput,
            );
          }
          // If input is 10 digits, it might already have leading 0
          else if (normalizedInput.length === 10 && normalizedInput.startsWith('0')) {
            const withoutZero = normalizedInput.substring(1);
            phoneVariations.push(
              normalizedInput,
              `+962${withoutZero}`,
              `00962${withoutZero}`,
              `962${withoutZero}`,
              withoutZero,
            );
          }
          // If input is 12 digits, might already have country code
          else if (normalizedInput.length === 12 && normalizedInput.startsWith('966')) {
            const withoutCountry = normalizedInput.substring(3);
            phoneVariations.push(
              normalizedInput,
              `+${normalizedInput}`,
              `00${normalizedInput}`,
              `0${withoutCountry}`,
              withoutCountry,
            );
          }
          // If input is 13 digits, might have +966
          else if (normalizedInput.length === 13 && normalizedInput.startsWith('966')) {
            const withoutCountry = normalizedInput.substring(3);
            phoneVariations.push(
              `+${normalizedInput}`,
              `00${normalizedInput}`,
              normalizedInput,
              `0${withoutCountry}`,
              withoutCountry,
            );
          }
          else {
            // Default: try common variations
            phoneVariations.push(
              phoneToCheck,
              `+962${phoneToCheck}`,
              `00962${phoneToCheck}`,
              `962${phoneToCheck}`,
              `0${phoneToCheck}`,
              `+${phoneToCheck}`,
            );
          }

          // Remove duplicates
          const uniqueVariations = [...new Set(phoneVariations)];
          console.log(`[DEBUG] Trying ${uniqueVariations.length} phone variations:`, uniqueVariations.slice(0, 5));

          // Try each variation
          for (const variation of uniqueVariations) {
            if (variation === phoneToCheck && user) continue; // Already tried

            user = await prisma.user.findFirst({
              where: {
                phoneNumber: variation,
              },
            });

            if (user) {
              console.log(`[DEBUG] Found user with variation: ${variation}`);
              break;
            }
          }

          // If still not found, try normalized search on ALL users
          if (!user && normalizedInput.length >= 7) {
            console.log(`[DEBUG] Trying normalized search for: ${normalizedInput}`);
            try {
              // Get ALL users with phone numbers (no limit for comprehensive search)
              const allUsers = await prisma.user.findMany({
                where: {
                  phoneNumber: { not: null },
                },
                select: {
                  id: true,
                  phoneNumber: true,
                },
                // Remove take limit to search all users
              });

              console.log(`[DEBUG] Checking ${allUsers.length} users for normalized match`);

              // Find user whose normalized phone matches (try multiple matching strategies)
              let matchedUser = null;

              // Strategy 1: Exact normalized match
              matchedUser = allUsers.find(u => {
                if (!u.phoneNumber) return false;
                const normalizedStored = normalizePhoneNumber(u.phoneNumber);
                const matches = normalizedStored === normalizedInput;
                if (matches) {
                  console.log(`[DEBUG] Exact normalized match found! Stored: ${u.phoneNumber}, Normalized: ${normalizedStored}`);
                }
                return matches;
              });

              // Strategy 2: Match last 9 digits (Saudi mobile numbers)
              if (!matchedUser && normalizedInput.length >= 9) {
                const last9Digits = normalizedInput.slice(-9);
                matchedUser = allUsers.find(u => {
                  if (!u.phoneNumber) return false;
                  const normalizedStored = normalizePhoneNumber(u.phoneNumber);
                  const storedLast9 = normalizedStored.slice(-9);
                  const matches = storedLast9 === last9Digits;
                  if (matches) {
                    console.log(`[DEBUG] Last 9 digits match found! Stored: ${u.phoneNumber}, Normalized: ${normalizedStored}, Last9: ${storedLast9}`);
                  }
                  return matches;
                });
              }

              // Strategy 3: Match last 7 digits (more flexible)
              if (!matchedUser && normalizedInput.length >= 7) {
                const last7Digits = normalizedInput.slice(-7);
                matchedUser = allUsers.find(u => {
                  if (!u.phoneNumber) return false;
                  const normalizedStored = normalizePhoneNumber(u.phoneNumber);
                  const storedLast7 = normalizedStored.slice(-7);
                  const matches = storedLast7 === last7Digits && normalizedStored.length >= 7;
                  if (matches) {
                    console.log(`[DEBUG] Last 7 digits match found! Stored: ${u.phoneNumber}, Normalized: ${normalizedStored}, Last7: ${storedLast7}`);
                  }
                  return matches;
                });
              }

              if (matchedUser) {
                console.log(`[DEBUG] Fetching full user object for ID: ${matchedUser.id}`);
                // Fetch full user object
                user = await prisma.user.findUnique({
                  where: { id: matchedUser.id },
                });
              } else {
                console.log(`[DEBUG] No normalized match found after checking ${allUsers.length} users`);
                // Log first few phone numbers for debugging
                if (allUsers.length > 0) {
                  console.log(`[DEBUG] Sample stored phone numbers:`, allUsers.slice(0, 5).map(u => `${u.phoneNumber} (normalized: ${normalizePhoneNumber(u.phoneNumber)})`));
                }
              }
            } catch (normalizeSearchError) {
              console.error('Error in normalized phone search:', normalizeSearchError);
              // Continue without user - will return 401
            }
          }
        } catch (normalizeError) {
          console.error('Error in normalized phone lookup:', normalizeError);
          // Continue without user - will return 401
        }
      }

      if (user) {
        console.log(`[DEBUG] User found: ID=${user.id}, Role=${user.role}, Phone=${user.phoneNumber}`);
      } else {
        console.log(`[DEBUG] User not found for phone: ${phoneToCheck}`);
      }
    } else {
      // For email/username, use normal lookup
      if (orConditions.length > 0) {
        user = await prisma.user.findFirst({
          where: {
            OR: orConditions,
          },
        });
      }
    }

    return user;
  } catch (error) {
    console.error('Error in findUserByIdentifiers:', error);
    throw error;
  }
};

const resolveIdentifiers = (body) => {
  let {
    email,
    username,
    phoneNumber,
    phone,
    emailOrPhone,
  } = body;

  let emailToCheck = email;
  let usernameToCheck = username;
  let phoneToCheck = phoneNumber || phone;

  if (emailOrPhone) {
    if (typeof emailOrPhone === 'string' && emailOrPhone.includes('@')) {
      emailToCheck = emailOrPhone;
    } else {
      phoneToCheck = emailOrPhone;
    }
  }

  // Normalize phone numbers for consistent matching
  phoneToCheck = normalizePhoneNumber(phoneToCheck);

  return { emailToCheck, usernameToCheck, phoneToCheck };
};

const ensureJwtSecret = () => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined in environment variables');
  }
};

const issueAuthResponse = (user) => {
  ensureJwtSecret();
  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  return {
    token,
    user: sanitizeUser(user),
  };
};

const ensureVendorEligibility = async (user) => {
  if (user.role !== 'bakery_owner' && user.role !== 'restaurant_owner') {
    return;
  }

  const whereClause = {
    ownerId: user.id,
    status: 'approved',
    deletedAt: null,
  };

  const pendingWhereClause = {
    ownerId: user.id,
    status: 'pending_approval',
    deletedAt: null,
  };

  if (user.role === 'bakery_owner') {
    const approvedVendor = await prisma.bakery.findFirst({ where: whereClause });
    if (approvedVendor) return; // ✅ Has approved bakery → allow login

    const pendingVendor = await prisma.bakery.findFirst({ where: pendingWhereClause });
    if (pendingVendor) {
      // ⚠️ Has pending bakery → allow login but inform user
      // User can login to check status, but vendor features will be restricted
      console.log(`[DEBUG] Bakery owner ${user.id} has pending bakery - allowing login with restrictions`);
      return; // Allow login, frontend can check vendorStatus
    }

    // ⚠️ No bakery registered → allow login so user can register bakery
    // User needs to login first to register bakery (bakery registration requires auth)
    console.log(`[DEBUG] Bakery owner ${user.id} has no bakery - allowing login to register bakery`);
    return; // Allow login, frontend can check vendorStatus and prompt to register
  }

  if (user.role === 'restaurant_owner') {
    const approvedVendor = await prisma.restaurant.findFirst({ where: whereClause });
    if (approvedVendor) return; // ✅ Has approved restaurant → allow login

    const pendingVendor = await prisma.restaurant.findFirst({ where: pendingWhereClause });
    if (pendingVendor) {
      // ⚠️ Has pending restaurant → allow login but inform user
      console.log(`[DEBUG] Restaurant owner ${user.id} has pending restaurant - allowing login with restrictions`);
      return; // Allow login, frontend can check vendorStatus
    }

    // ⚠️ No restaurant registered → allow login so user can register restaurant
    console.log(`[DEBUG] Restaurant owner ${user.id} has no restaurant - allowing login to register restaurant`);
    return; // Allow login, frontend can check vendorStatus and prompt to register
  }
};

// Register a new user
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, fullName, phoneNumber, role } = req.body;

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email },
          { username }
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({
        status: 'fail',
        message: 'User with this email or username already exists'
      });
    }

    // If password is not provided (OTP flow), generate a secure random one
    const passwordToStore = password || Math.random().toString(36).slice(-12);

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(passwordToStore, salt);

    // Create new user
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        fullName,
        phoneNumber,
        role: role || 'customer'
      }
    });

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Return user data (excluding password) and token
    const userData = { ...user };
    delete userData.password;

    return res.status(201).json({
      status: 'success',
      data: {
        user: userData,
        token
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred during registration'
    });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { otp, purpose = 'login' } = req.body;
    const { emailToCheck, usernameToCheck, phoneToCheck } =
      resolveIdentifiers(req.body);

    if (!emailToCheck && !usernameToCheck && !phoneToCheck) {
      return res.status(400).json({
        status: 'fail',
        message: 'Please provide email, username, or phone number',
      });
    }

    const user = await findUserByIdentifiers(emailToCheck, usernameToCheck, phoneToCheck);

    if (!user) {
      return res.status(401).json({
        status: 'fail',
        message: 'Invalid credentials',
      });
    }

    if (user.deletedAt) {
      return res.status(403).json({
        status: 'fail',
        message: 'Your account is suspended. Please contact support.',
      });
    }

    const identifier =
      phoneToCheck || user.phoneNumber || emailToCheck || user.email ||
      usernameToCheck || user.username;

    if (!otp) {
      // Remove vendor eligibility check before OTP to allow all users to receive OTP
      // Vendor status will be checked after OTP verification if needed

      const generatedOtp = generateOtpCode();
      const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          otp: generatedOtp,
          otpExpiry,
        },
      });

      // Send OTP via SMS if phone number is available
      if (phoneToCheck || user.phoneNumber) {
        const phoneNumber = phoneToCheck || user.phoneNumber;
        try {
          const smsResult = await sendOTPviaSMS(phoneNumber, generatedOtp);
          if (smsResult.success) {
            console.log(`✅ OTP SMS sent successfully to ${phoneNumber}`);
          } else {
            console.warn(`⚠️  Failed to send OTP SMS to ${phoneNumber}: ${smsResult.error}`);
            // Continue anyway - OTP is still generated and stored
          }
        } catch (smsError) {
          console.error('❌ Error sending OTP SMS:', smsError);
          // Continue anyway - OTP is still generated and stored
        }
      }

      // Enhanced OTP logging for development
      console.log('═══════════════════════════════════════════════════════════');
      console.log('🔐 BACKEND OTP GENERATED');
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`📱 Phone/Email: ${identifier}`);
      console.log(`👤 User ID: ${user.id}`);
      console.log(`🎯 Purpose: ${purpose}`);
      console.log(`🔑 OTP CODE: ${generatedOtp}`);
      console.log(`⏰ Expires At: ${otpExpiry.toISOString()}`);
      console.log(`⏱️  Valid for: ${OTP_EXPIRY_MINUTES} minutes`);
      console.log('═══════════════════════════════════════════════════════════');

      return res.status(200).json({
        status: 'success',
        data: {
          verificationId: identifier,
          expiresAt: otpExpiry,
          ...(process.env.NODE_ENV !== 'production' && { otp: generatedOtp }),
        },
        message: `OTP sent to ${identifier}`,
      });
    }

    if (!user.otp || !user.otpExpiry) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid or expired OTP',
      });
    }

    const now = new Date();
    if (user.otp !== otp || user.otpExpiry < now) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid or expired OTP',
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        otp: null,
        otpExpiry: null,
        ...(purpose === 'registration' && !user.isVerified
          ? { isVerified: true }
          : {}),
      },
    });

    if (purpose === 'login') {
      console.log(`[DEBUG] OTP verified for login, checking vendor eligibility`);
      console.log(`[DEBUG] Updated user after OTP verification:`, {
        id: updatedUser.id,
        role: updatedUser.role,
        isVerified: updatedUser.isVerified,
        email: updatedUser.email,
        phoneNumber: updatedUser.phoneNumber,
      });

      // Check vendor status (informational - no longer blocking login)
      // Users can login to register bakery or check approval status
      let vendorStatus = null;
      if (updatedUser.role === 'bakery_owner' || updatedUser.role === 'restaurant_owner') {
        try {
          const whereClause = {
            ownerId: updatedUser.id,
            deletedAt: null,
          };

          if (updatedUser.role === 'bakery_owner') {
            const approvedBakery = await prisma.bakery.findFirst({
              where: { ...whereClause, status: 'approved' }
            });
            const pendingBakery = await prisma.bakery.findFirst({
              where: { ...whereClause, status: 'pending_approval' }
            });

            if (approvedBakery) {
              vendorStatus = { hasVendor: true, vendorApproved: true, vendorPending: false, vendorType: 'bakery' };
            } else if (pendingBakery) {
              vendorStatus = { hasVendor: true, vendorApproved: false, vendorPending: true, vendorType: 'bakery' };
            } else {
              vendorStatus = { hasVendor: false, vendorApproved: false, vendorPending: false, vendorType: 'bakery' };
            }
          } else if (updatedUser.role === 'restaurant_owner') {
            const approvedRestaurant = await prisma.restaurant.findFirst({
              where: { ...whereClause, status: 'approved' }
            });
            const pendingRestaurant = await prisma.restaurant.findFirst({
              where: { ...whereClause, status: 'pending_approval' }
            });

            if (approvedRestaurant) {
              vendorStatus = { hasVendor: true, vendorApproved: true, vendorPending: false, vendorType: 'restaurant' };
            } else if (pendingRestaurant) {
              vendorStatus = { hasVendor: true, vendorApproved: false, vendorPending: true, vendorType: 'restaurant' };
            } else {
              vendorStatus = { hasVendor: false, vendorApproved: false, vendorPending: false, vendorType: 'restaurant' };
            }
          }

          console.log(`[DEBUG] Vendor status for user ${updatedUser.id}:`, vendorStatus);
        } catch (error) {
          console.log(`[DEBUG] Error checking vendor status: ${error.message}`);
        }
      }

      const data = issueAuthResponse(updatedUser);
      console.log(`[DEBUG] Login successful, issuing auth response for user ${updatedUser.id}`);
      return res.status(200).json({
        status: 'success',
        data: {
          ...data,
          ...(vendorStatus && { vendorStatus }),
        },
        message: 'Login successful',
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'OTP verified successfully',
      data: {
        user: sanitizeUser(updatedUser),
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred during login',
      ...(process.env.NODE_ENV === 'development' && {
        error: error.message,
        stack: error.stack,
      }),
    });
  }
});

router.post('/resend-otp', async (req, res) => {
  try {
    const { purpose = 'login' } = req.body;
    const { emailToCheck, usernameToCheck, phoneToCheck } = resolveIdentifiers(req.body);

    if (!emailToCheck && !usernameToCheck && !phoneToCheck) {
      return res.status(400).json({
        status: 'fail',
        message: 'Please provide email, username, or phone number',
      });
    }

    const user = await findUserByIdentifiers(emailToCheck, usernameToCheck, phoneToCheck);

    if (!user) {
      return res.status(404).json({
        status: 'fail',
        message: 'User not found',
      });
    }

    if (user.deletedAt) {
      return res.status(403).json({
        status: 'fail',
        message: 'Your account is suspended. Please contact support.',
      });
    }

    if (purpose === 'login') {
      try {
        await ensureVendorEligibility(user);
      } catch (error) {
        return res.status(error.statusCode || 403).json({
          status: 'fail',
          message: error.message,
          ...(error.payload || {}),
        });
      }
    }

    const otp = generateOtpCode();
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        otp,
        otpExpiry,
      },
    });

    // Send OTP via SMS if phone number is available
    if (phoneToCheck || user.phoneNumber) {
      const phoneNumber = phoneToCheck || user.phoneNumber;
      try {
        const smsResult = await sendOTPviaSMS(phoneNumber, otp);
        if (smsResult.success) {
          console.log(`✅ OTP SMS resent successfully to ${phoneNumber}`);
        } else {
          console.warn(`⚠️  Failed to resend OTP SMS to ${phoneNumber}: ${smsResult.error}`);
          // Continue anyway - OTP is still generated and stored
        }
      } catch (smsError) {
        console.error('❌ Error resending OTP SMS:', smsError);
        // Continue anyway - OTP is still generated and stored
      }
    }

    // Enhanced OTP logging for development
    const identifier = phoneToCheck || emailToCheck || user.phoneNumber || user.email;
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔐 BACKEND OTP RESENT');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`📱 Phone/Email: ${identifier}`);
    console.log(`👤 User ID: ${user.id}`);
    console.log(`🎯 Purpose: ${purpose}`);
    console.log(`🔑 OTP CODE: ${otp}`);
    console.log(`⏰ Expires At: ${otpExpiry.toISOString()}`);
    console.log(`⏱️  Valid for: ${OTP_EXPIRY_MINUTES} minutes`);
    console.log('═══════════════════════════════════════════════════════════');

    return res.status(200).json({
      status: 'success',
      data: {
        verificationId: phoneToCheck || emailToCheck || user.phoneNumber || user.email,
        expiresAt: otpExpiry,
        ...(process.env.NODE_ENV !== 'production' && { otp }),
      },
      message: 'OTP sent successfully',
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while sending OTP',
    });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const { purpose = 'login', otp } = req.body;
    const { emailToCheck, usernameToCheck, phoneToCheck } = resolveIdentifiers(req.body);

    if (!otp) {
      return res.status(400).json({
        status: 'fail',
        message: 'OTP is required',
      });
    }

    if (!emailToCheck && !usernameToCheck && !phoneToCheck) {
      return res.status(400).json({
        status: 'fail',
        message: 'Please provide email, username, or phone number',
      });
    }

    const user = await findUserByIdentifiers(emailToCheck, usernameToCheck, phoneToCheck);

    if (!user || !user.otp || !user.otpExpiry) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid or expired OTP',
      });
    }

    if (user.deletedAt) {
      return res.status(403).json({
        status: 'fail',
        message: 'Your account is suspended. Please contact support.',
      });
    }

    const now = new Date();
    if (user.otp !== otp || user.otpExpiry < now) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid or expired OTP',
      });
    }

    let updateData = { otp: null, otpExpiry: null };

    if (purpose === 'registration' && !user.isVerified) {
      updateData.isVerified = true;
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    if (purpose === 'login') {
      try {
        await ensureVendorEligibility(updatedUser);
      } catch (error) {
        return res.status(error.statusCode || 403).json({
          status: 'fail',
          message: error.message,
          ...(error.payload || {}),
        });
      }

      const data = issueAuthResponse(updatedUser);
      return res.status(200).json({
        status: 'success',
        data,
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'OTP verified successfully',
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while verifying OTP',
    });
  }
});

// Logout (client-side token removal)
router.post('/logout', (req, res) => {
  return res.status(200).json({
    status: 'success',
    message: 'Logged out successfully'
  });
});

// Request password reset
router.post('/request-password-reset', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        status: 'fail',
        message: 'Email is required'
      });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // For security reasons, don't reveal if email exists or not
      return res.status(200).json({
        status: 'success',
        message: 'If your email is registered, you will receive a password reset link'
      });
    }

    // In a real implementation, generate a token and send an email
    // For now, just return success message
    return res.status(200).json({
      status: 'success',
      message: 'If your email is registered, you will receive a password reset link'
    });
  } catch (error) {
    console.error('Password reset request error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred during password reset request'
    });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        status: 'fail',
        message: 'Token and new password are required'
      });
    }

    // In a real implementation, verify the token and update the password
    // For now, just return a placeholder response
    return res.status(200).json({
      status: 'success',
      message: 'Password has been reset successfully'
    });
  } catch (error) {
    console.error('Password reset error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred during password reset'
    });
  }
});

// Verify email
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        status: 'fail',
        message: 'Token is required'
      });
    }

    // In a real implementation, verify the token and update the user's verification status
    // For now, just return a placeholder response
    return res.status(200).json({
      status: 'success',
      message: 'Email verified successfully'
    });
  } catch (error) {
    console.error('Email verification error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred during email verification'
    });
  }
});

// Login with Firebase token (Primary authentication method)
// Use this when using Firebase Auth on the client side
router.post('/login-with-firebase', async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        status: 'fail',
        message: 'Firebase ID token is required'
      });
    }

    // Verify Firebase token using centralized service
    let decodedToken;
    try {
      const { verifyIdToken } = require('../services/firebaseAdmin');
      decodedToken = await verifyIdToken(idToken);
    } catch (error) {
      if (error.message.includes('not initialized')) {
        return res.status(500).json({
          status: 'error',
          message: 'Firebase Admin SDK not configured. Please configure Firebase credentials in .env file'
        });
      }
      return res.status(401).json({
        status: 'fail',
        message: 'Invalid or expired Firebase token',
        ...(process.env.NODE_ENV === 'development' && { error: error.message })
      });
    }

    const firebaseUid = decodedToken.uid;
    const phoneNumber = decodedToken.phone_number;
    const email = decodedToken.email;

    if (!phoneNumber && !email) {
      return res.status(400).json({
        status: 'fail',
        message: 'Firebase token does not contain phone number or email'
      });
    }

    // Find or create user in database
    let user = await findUserByIdentifiers(email, null, phoneNumber);

    if (!user) {
      // Create new user from Firebase
      user = await prisma.user.create({
        data: {
          phoneNumber: phoneNumber || null,
          email: email || `firebase_${firebaseUid}@temp.com`,
          username: phoneNumber || email || `user_${firebaseUid.substring(0, 8)}`,
          password: Math.random().toString(36).slice(-12), // Random password (not used for Firebase auth)
          fullName: decodedToken.name || null,
          role: 'customer',
          isVerified: true, // Firebase verified users are already verified
        },
      });
    } else {
      // Update user if needed (e.g., mark as verified)
      if (!user.isVerified) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { isVerified: true },
        });
      }
    }

    if (user.deletedAt) {
      return res.status(403).json({
        status: 'fail',
        message: 'Your account is suspended. Please contact support.',
      });
    }

    // Check vendor status (informational - no longer blocking login)
    // Users can login to register bakery or check approval status
    let vendorStatus = null;
    if (user.role === 'bakery_owner' || user.role === 'restaurant_owner') {
      try {
        const whereClause = {
          ownerId: user.id,
          deletedAt: null,
        };

        if (user.role === 'bakery_owner') {
          const approvedBakery = await prisma.bakery.findFirst({
            where: { ...whereClause, status: 'approved' }
          });
          const pendingBakery = await prisma.bakery.findFirst({
            where: { ...whereClause, status: 'pending_approval' }
          });

          if (approvedBakery) {
            vendorStatus = { hasVendor: true, vendorApproved: true, vendorPending: false, vendorType: 'bakery' };
          } else if (pendingBakery) {
            vendorStatus = { hasVendor: true, vendorApproved: false, vendorPending: true, vendorType: 'bakery' };
          } else {
            vendorStatus = { hasVendor: false, vendorApproved: false, vendorPending: false, vendorType: 'bakery' };
          }
        } else if (user.role === 'restaurant_owner') {
          const approvedRestaurant = await prisma.restaurant.findFirst({
            where: { ...whereClause, status: 'approved' }
          });
          const pendingRestaurant = await prisma.restaurant.findFirst({
            where: { ...whereClause, status: 'pending_approval' }
          });

          if (approvedRestaurant) {
            vendorStatus = { hasVendor: true, vendorApproved: true, vendorPending: false, vendorType: 'restaurant' };
          } else if (pendingRestaurant) {
            vendorStatus = { hasVendor: true, vendorApproved: false, vendorPending: true, vendorType: 'restaurant' };
          } else {
            vendorStatus = { hasVendor: false, vendorApproved: false, vendorPending: false, vendorType: 'restaurant' };
          }
        }

        console.log(`[DEBUG] Vendor status for user ${user.id}:`, vendorStatus);
      } catch (error) {
        console.log(`[DEBUG] Error checking vendor status: ${error.message}`);
      }
    }

    const data = issueAuthResponse(user);
    return res.status(200).json({
      status: 'success',
      data: {
        ...data,
        ...(vendorStatus && { vendorStatus }),
      },
      message: 'Login successful',
    });
  } catch (error) {
    console.error('Firebase login error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred during Firebase login',
      ...(process.env.NODE_ENV === 'development' && {
        error: error.message,
        stack: error.stack,
      }),
    });
  }
});

module.exports = router;
