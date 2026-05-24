const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { sendOTPviaSMS } = require('../services/smsService');
const { sendOtpPushToMany } = require('../services/pushNotificationService');
const { notifyUser } = require('../services/notificationDispatchService');
const { authenticateToken } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rate-limit');
const { logUserSecurityEvent } = require('../services/securityEventService');
const Redis = require('ioredis');
const rateLimits = new Map(); // in-memory fallback
const redisUrl = process.env.REDIS_URL;
const redis =
  redisUrl && typeof redisUrl === 'string' && redisUrl.length > 0
    ? new Redis(redisUrl)
    : null;

const router = express.Router();

// Helper to ensure a JWT secret exists (dev fallback)
const getJwtSecret = () => {
  const secrets = [
    process.env.JWT_SECRET,
    process.env.JWT_SECRET_KEY,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  if (secrets.length > 0) return secrets[0];
  if (String(process.env.NODE_ENV || '').toLowerCase() !== 'production') {
    return 'dev-temp-secret-change-me';
  }
  throw new Error('JWT secret is not configured');
};
const getJwtExpiresIn = () =>
  process.env.JWT_EXPIRES_IN || process.env.JWT_TOKEN_EXPIRES_IN || '7d';
const getJwtSignOptions = () => {
  const options = { expiresIn: getJwtExpiresIn() };
  const issuer = String(process.env.JWT_ISSUER || '').trim();
  const audience = String(process.env.JWT_AUDIENCE || '').trim();
  if (issuer) options.issuer = issuer;
  if (audience) options.audience = audience;
  return options;
};

const OTP_EXPIRY_MINUTES = 10;
const OTP_VERIFY_WINDOW_MS = Number(process.env.OTP_VERIFY_WINDOW_MS || 15 * 60 * 1000);
const OTP_MAX_FAILED_ATTEMPTS = Number(process.env.OTP_MAX_FAILED_ATTEMPTS || 5);
const otpRouteLimiter = createRateLimiter({
  keyPrefix: 'auth:otp',
  windowMs: 60 * 1000,
  maxRequests: Number(process.env.AUTH_OTP_ROUTE_MAX_PER_MINUTE || 30),
  message: 'Too many OTP requests. Please try again later.',
});

const sanitizeUser = (user) => {
  const { password, otp, otpExpiry, ...userData } = user;
  return userData;
};

const generateOtpCode = () => Math.floor(100000 + Math.random() * 900000).toString();

// Extract device token from common client payload keys
const resolveDeviceToken = (body = {}) =>
  body.deviceToken ||
  body.fcmToken ||
  body.device_token ||
  body.fcm_token ||
  body.pushToken ||
  body.push_token ||
  null;

const hasDeviceTokenModel = () =>
  !!prisma?.deviceToken &&
  typeof prisma.deviceToken.upsert === 'function' &&
  typeof prisma.deviceToken.findMany === 'function';

let hasLoggedMissingDeviceTokenModel = false;
const logMissingDeviceTokenModelOnce = () => {
  if (hasLoggedMissingDeviceTokenModel) return;
  hasLoggedMissingDeviceTokenModel = true;
  console.warn(
    '⚠️  Prisma DeviceToken model is unavailable; skipping device-token persistence and push-token lookup.'
  );
};

const isDeviceTokenTableMissingError = (error) =>
  (error?.code === 'P2021' || error?.code === 'P2022') &&
  (
    error?.meta?.modelName === 'DeviceToken' ||
    (typeof error?.meta?.table === 'string' && error.meta.table.includes('device_tokens')) ||
    (typeof error?.meta?.column === 'string' && error.meta.column.includes('device_tokens'))
  );

// Upsert a device token for the user to reuse later (push notifications)
const upsertDeviceToken = async (userId, token, platform) => {
  if (!userId || !token) return null;
  if (!hasDeviceTokenModel()) {
    logMissingDeviceTokenModelOnce();
    return null;
  }

  try {
    const saved = await prisma.deviceToken?.upsert?.({
      where: { token },
      update: { userId, platform, lastUsed: new Date() },
      create: { token, userId, platform },
    });
    return saved || null;
  } catch (error) {
    console.error('❌ Error saving device token:', error.message);
    return null;
  }
};

const sendOtpPushToUserDevices = async ({
  userId,
  deviceToken,
  otpCode,
  purpose = 'login',
  identifier = '',
}) => {
  if (!userId || !otpCode) {
    return { success: false, attempted: 0, error: 'Missing userId or otpCode' };
  }

  const tokenSet = new Set();
  const requestToken = deviceToken?.toString().trim();
  if (requestToken) tokenSet.add(requestToken);

  if (hasDeviceTokenModel() && typeof prisma.deviceToken.findMany === 'function') {
    try {
      const storedTokens = await prisma.deviceToken.findMany({
        where: { userId },
        select: { token: true },
      });
      storedTokens
        .map((entry) => entry?.token?.toString().trim())
        .filter(Boolean)
        .forEach((token) => tokenSet.add(token));
    } catch (error) {
      if (isDeviceTokenTableMissingError(error)) {
        console.warn(
          '⚠️  device_tokens table missing; skipping stored push-token lookup and continuing auth flow.'
        );
      } else {
        console.error('❌ Error loading stored device tokens:', error.message);
      }
    }
  } else {
    logMissingDeviceTokenModelOnce();
  }

  const tokens = Array.from(tokenSet);
  if (!tokens.length) {
    return { success: false, attempted: 0, error: 'No device token available for OTP push' };
  }

  const pushResult = await sendOtpPushToMany(
    tokens,
    otpCode,
    purpose,
    identifier?.toString() || ''
  );

  if (
    pushResult?.invalidTokens?.length &&
    hasDeviceTokenModel() &&
    typeof prisma.deviceToken.deleteMany === 'function'
  ) {
    await prisma.deviceToken.deleteMany({
      where: {
        userId,
        token: { in: pushResult.invalidTokens },
      },
    });
  }

  return pushResult;
};

// Normalize phone number by removing all non-digit characters
const normalizePhoneNumber = (phone) => {
  if (!phone) return null;
  // Remove all non-digit characters
  return phone.toString().replace(/\D/g, '');
};

// Simple in-memory rate limiter for OTP requests
const canRequestOtp = async (key) => {
  // Keep strict OTP throttling in production, but be more permissive in
  // development/test to avoid locking local QA flows.
  const isProduction = process.env.NODE_ENV === 'production';
  const WINDOW_MS = isProduction ? 10 * 60 * 1000 : 60 * 1000;
  const MAX_ATTEMPTS = isProduction ? 5 : 50;
  if (!key) return false;

  if (redis) {
    const redisKey = `otp:limiter:${key}`;
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.pexpire(redisKey, WINDOW_MS);
    }
    return count <= MAX_ATTEMPTS;
  }

  const now = Date.now();
  const entry = rateLimits.get(key) || { count: 0, windowStart: now };
  if (now - entry.windowStart > WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  rateLimits.set(key, entry);
  return entry.count <= MAX_ATTEMPTS;
};

// Helper function to find user by email, username, or normalized phone.
// preferredRole (when provided) is used as a tie-breaker for phone variations.
const findUserByIdentifiers = async (
  emailToCheck,
  usernameToCheck,
  phoneToCheck,
  preferredRole = null
) => {
  try {
    const isPhoneColumnMissingError = (error) =>
      error?.code === 'P2022' &&
      typeof error?.meta?.column === 'string' &&
      error.meta.column.includes('phoneNumber');

    const mapRawUserRow = (row) => {
      if (!row || typeof row !== 'object') return row;
      return {
        ...row,
        fullName: row.fullName ?? row.full_name ?? null,
        phoneNumber: row.phoneNumber ?? row.phone_number ?? null,
        isVerified: row.isVerified ?? row.is_verified ?? false,
        profilePictureUrl:
          row.profilePictureUrl ?? row.profile_picture_url ?? null,
        createdAt: row.createdAt ?? row.created_at ?? null,
        createdBy: row.createdBy ?? row.created_by ?? null,
        updatedAt: row.updatedAt ?? row.updated_at ?? null,
        updatedBy: row.updatedBy ?? row.updated_by ?? null,
        deletedAt: row.deletedAt ?? row.deleted_at ?? null,
      };
    };

    const findUserByPhoneRaw = async (
      phoneNumber,
      {
        role = null,
        includeDeleted = true,
      } = {}
    ) => {
      if (!phoneNumber) return null;

      const conditions = ['"phone_number" = $1'];
      const params = [phoneNumber];
      let paramIndex = params.length + 1;

      if (!includeDeleted) {
        conditions.push('"deleted_at" IS NULL');
      }

      if (role) {
        conditions.push(`"role" = $${paramIndex}::"UserRole"`);
        params.push(role);
      }

      const query = `
        SELECT *
        FROM users
        WHERE ${conditions.join(' AND ')}
        ORDER BY "updated_at" DESC NULLS LAST, "created_at" DESC
        LIMIT 1
      `;

      const rows = await prisma.$queryRawUnsafe(query, ...params);
      if (!Array.isArray(rows) || rows.length === 0) return null;
      return mapRawUserRow(rows[0]);
    };

    const loadUsersForNormalizedPhoneSearch = async () => {
      try {
        return await prisma.user.findMany({
          select: {
            id: true,
            phoneNumber: true,
            role: true,
            deletedAt: true,
          },
        });
      } catch (error) {
        if (!isPhoneColumnMissingError(error)) throw error;
        const rows = await prisma.$queryRawUnsafe(`
          SELECT id, role, deleted_at, phone_number
          FROM users
        `);
        return (Array.isArray(rows) ? rows : []).map((row) => ({
          id: row.id,
          role: row.role,
          deletedAt: row.deleted_at ?? null,
          phoneNumber: row.phone_number ?? null,
        }));
      }
    };

    const normalizedPreferredRole =
      typeof preferredRole === 'string' && preferredRole.trim().length > 0
        ? preferredRole.trim().toLowerCase()
        : null;

    const findUserByPhoneWithRolePriority = async (
      phoneNumber,
      {
        allowRoleFallback = true,
        includeDeleted = true,
      } = {}
    ) => {
      if (!phoneNumber) return null;

      const baseWhere = {
        phoneNumber,
        ...(includeDeleted ? {} : { deletedAt: null }),
      };

      try {
        if (normalizedPreferredRole) {
          const roleMatchedUser = await prisma.user.findFirst({
            where: {
              ...baseWhere,
              role: normalizedPreferredRole,
            },
          });
          if (roleMatchedUser) return roleMatchedUser;
        }

        if (!allowRoleFallback && normalizedPreferredRole) {
          return null;
        }

        return prisma.user.findFirst({
          where: baseWhere,
        });
      } catch (error) {
        if (!isPhoneColumnMissingError(error)) throw error;

        if (normalizedPreferredRole) {
          const roleMatchedRaw = await findUserByPhoneRaw(phoneNumber, {
            role: normalizedPreferredRole,
            includeDeleted,
          });
          if (roleMatchedRaw) return roleMatchedRaw;
        }

        if (!allowRoleFallback && normalizedPreferredRole) {
          return null;
        }

        return findUserByPhoneRaw(phoneNumber, { includeDeleted });
      }
    };

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
        // Prefer email/username lookups first; phone lookup handled separately.
        if (normalizedPreferredRole) {
          user = await prisma.user.findFirst({
            where: {
              role: normalizedPreferredRole,
              OR: orConditions,
            },
          });
        }

        if (!user) {
          user = await prisma.user.findFirst({
            where: {
              OR: orConditions,
            },
          });
        }

        if (!user) {
          user = await findUserByPhoneWithRolePriority(phoneToCheck, {
            allowRoleFallback: !normalizedPreferredRole,
            includeDeleted: false,
          });
          if (!user) {
            user = await findUserByPhoneWithRolePriority(phoneToCheck, {
              allowRoleFallback: !normalizedPreferredRole,
              includeDeleted: true,
            });
          }
        }
      } else {
        // Only phone number provided
        user = await findUserByPhoneWithRolePriority(phoneToCheck, {
          allowRoleFallback: !normalizedPreferredRole,
          includeDeleted: false,
        });
        if (!user) {
          user = await findUserByPhoneWithRolePriority(phoneToCheck, {
            allowRoleFallback: !normalizedPreferredRole,
            includeDeleted: true,
          });
        }
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

          if (normalizedPreferredRole) {
            // Pass 1: requested role + active accounts only.
            for (const variation of uniqueVariations) {
              if (variation === phoneToCheck && user) continue; // Already tried

              user = await findUserByPhoneWithRolePriority(variation, {
                allowRoleFallback: false,
                includeDeleted: false,
              });

              if (user) {
                console.log(
                  `[DEBUG] Found role-priority user with variation: ${variation}`
                );
                break;
              }
            }
          }

          if (!user) {
            // Pass 2: any role, active accounts only.
            for (const variation of uniqueVariations) {
              if (variation === phoneToCheck && user) continue; // Already tried

              user = await findUserByPhoneWithRolePriority(variation, {
                allowRoleFallback: true,
                includeDeleted: false,
              });

              if (user) {
                console.log(`[DEBUG] Found user with variation: ${variation}`);
                break;
              }
            }
          }

          if (!user && normalizedPreferredRole) {
            // Pass 3: requested role, including deleted accounts.
            for (const variation of uniqueVariations) {
              if (variation === phoneToCheck && user) continue; // Already tried

              user = await findUserByPhoneWithRolePriority(variation, {
                allowRoleFallback: false,
                includeDeleted: true,
              });

              if (user) {
                console.log(
                  `[DEBUG] Found role-priority (including deleted) user with variation: ${variation}`
                );
                break;
              }
            }
          }

          if (!user) {
            // Pass 4: any role, including deleted accounts.
            for (const variation of uniqueVariations) {
              if (variation === phoneToCheck && user) continue; // Already tried

              user = await findUserByPhoneWithRolePriority(variation, {
                allowRoleFallback: true,
                includeDeleted: true,
              });

              if (user) {
                console.log(
                  `[DEBUG] Found user (including deleted) with variation: ${variation}`
                );
                break;
              }
            }
          }

          // If still not found, try normalized search on ALL users
          if (!user && normalizedInput.length >= 7) {
            console.log(`[DEBUG] Trying normalized search for: ${normalizedInput}`);
            try {
          // Get ALL users with phone numbers (no limit for comprehensive search)
          const allUsers = await loadUsersForNormalizedPhoneSearch();

              console.log(`[DEBUG] Checking ${allUsers.length} users for normalized match`);

              const pickMatchedUser = (matches) => {
                if (!matches.length) return null;
                const activeMatches = matches.filter(
                  (candidate) => candidate.deletedAt == null
                );
                const candidatePool =
                  activeMatches.length > 0 ? activeMatches : matches;
                if (normalizedPreferredRole) {
                  const preferred = candidatePool.find(
                    (candidate) => candidate.role?.toLowerCase() === normalizedPreferredRole
                  );
                  if (preferred) return preferred;
                }
                return candidatePool[0];
              };

              // Find user whose normalized phone matches (try multiple matching strategies)
              let matchedUser = null;

              // Strategy 1: Exact normalized match
              matchedUser = pickMatchedUser(
                allUsers.filter((u) => {
                  if (!u.phoneNumber) return false;
                  const normalizedStored = normalizePhoneNumber(u.phoneNumber);
                  const matches = normalizedStored === normalizedInput;
                  if (matches) {
                    console.log(`[DEBUG] Exact normalized match found! Stored: ${u.phoneNumber}, Normalized: ${normalizedStored}`);
                  }
                  return matches;
                })
              );

              // Strategy 2: Match last 9 digits (Saudi mobile numbers)
              if (!matchedUser && normalizedInput.length >= 9) {
                const last9Digits = normalizedInput.slice(-9);
                matchedUser = pickMatchedUser(
                  allUsers.filter((u) => {
                    if (!u.phoneNumber) return false;
                    const normalizedStored = normalizePhoneNumber(u.phoneNumber);
                    const storedLast9 = normalizedStored.slice(-9);
                    const matches = storedLast9 === last9Digits;
                    if (matches) {
                      console.log(`[DEBUG] Last 9 digits match found! Stored: ${u.phoneNumber}, Normalized: ${normalizedStored}, Last9: ${storedLast9}`);
                    }
                    return matches;
                  })
                );
              }

              // Strategy 3: Match last 7 digits (more flexible)
              if (!matchedUser && normalizedInput.length >= 7) {
                const last7Digits = normalizedInput.slice(-7);
                matchedUser = pickMatchedUser(
                  allUsers.filter((u) => {
                    if (!u.phoneNumber) return false;
                    const normalizedStored = normalizePhoneNumber(u.phoneNumber);
                    const storedLast7 = normalizedStored.slice(-7);
                    const matches = storedLast7 === last7Digits && normalizedStored.length >= 7;
                    if (matches) {
                      console.log(`[DEBUG] Last 7 digits match found! Stored: ${u.phoneNumber}, Normalized: ${normalizedStored}, Last7: ${storedLast7}`);
                    }
                    return matches;
                  })
                );
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
        if (normalizedPreferredRole) {
          user = await prisma.user.findFirst({
            where: {
              role: normalizedPreferredRole,
              OR: orConditions,
            },
          });
        }

        if (!user) {
          user = await prisma.user.findFirst({
            where: {
              OR: orConditions,
            },
          });
        }
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

const issueAuthResponse = (user) => {
  const secret = getJwtSecret();
  const token = jwt.sign(
    { id: user.id, role: user.role },
    secret,
    getJwtSignOptions()
  );

  return {
    token,
    user: sanitizeUser(user),
  };
};

const createOtpNotification = async ({
  userId,
  otpCode,
  purpose = 'login',
  identifier = '',
}) => {
  if (!userId || !otpCode) return;

  try {
    const friendlyPurpose =
      purpose === 'registration'
        ? 'registration'
        : purpose === 'password_reset'
            ? 'password reset'
            : 'login';

    await notifyUser({
      prisma,
      userId,
      title: 'Verification Code',
      message:
        `Khubzati OTP for ${friendlyPurpose}: ${otpCode}. Valid for ${OTP_EXPIRY_MINUTES} minutes.`,
      type: 'account',
      createdBy: 'system',
      relatedId: null,
      sendPush: false,
      data: {
        event: 'otp_generated',
        purpose,
        identifier,
      },
    });
  } catch (error) {
    console.error('Failed to create OTP notification record:', error.message);
  }
};

const countRecentFailedOtpAttempts = async ({ userId = null, identifier = null }) => {
  const where = {
    eventType: 'otp_verify_failed',
    createdAt: {
      gte: new Date(Date.now() - OTP_VERIFY_WINDOW_MS),
    },
  };

  if (userId) {
    where.userId = userId;
  } else if (identifier) {
    where.identifier = identifier;
  } else {
    return 0;
  }

  return prisma.userSecurityEvent.count({ where });
};

const resolveVendorStatusForUser = async (user) => {
  if (!user || (user.role !== 'bakery_owner' && user.role !== 'restaurant_owner')) {
    return null;
  }

  const vendorOwnershipWhere = {
    deletedAt: null,
    OR: [
      { ownerId: user.id },
      { createdBy: user.id },
      { updatedBy: user.id },
    ],
  };

  const deriveVendorStatusFromRecords = (records, vendorType) => {
    if (!Array.isArray(records) || records.length === 0) {
      return {
        hasVendor: false,
        vendorApproved: false,
        vendorPending: false,
        vendorRejected: false,
        vendorType,
        vendorId: null,
        rejectionReason: null,
        rejectedAt: null,
      };
    }

    const normalizeStatus = (record) =>
      (record?.status || '').toString().trim().toLowerCase();
    const statuses = records.map(normalizeStatus);
    const hasApproved = statuses.some(
      (status) => status === 'approved' || status === 'active'
    );
    const hasPending = statuses.some(
      (status) => status === 'pending_approval' || status === 'pending'
    );
    const hasRejected = statuses.some((status) => status === 'rejected');
    const pickLatestByStatus = (statusMatcher) => records.find((record) => statusMatcher(normalizeStatus(record)));

    if (hasApproved) {
      const approvedRecord = pickLatestByStatus((status) => status === 'approved' || status === 'active');
      return {
        hasVendor: true,
        vendorApproved: true,
        vendorPending: false,
        vendorRejected: false,
        vendorType,
        vendorId: approvedRecord?.id || null,
        rejectionReason: null,
        rejectedAt: null,
      };
    }

    if (hasPending) {
      const pendingRecord = pickLatestByStatus(
        (status) => status === 'pending_approval' || status === 'pending'
      );
      return {
        hasVendor: true,
        vendorApproved: false,
        vendorPending: true,
        vendorRejected: false,
        vendorType,
        vendorId: pendingRecord?.id || null,
        rejectionReason: null,
        rejectedAt: null,
      };
    }

    if (hasRejected) {
      const rejectedRecord = pickLatestByStatus((status) => status === 'rejected');
      return {
        hasVendor: true,
        vendorApproved: false,
        vendorPending: false,
        vendorRejected: true,
        vendorType,
        vendorId: rejectedRecord?.id || null,
        rejectionReason: rejectedRecord?.rejectionReason || null,
        rejectedAt: rejectedRecord?.rejectedAt || null,
      };
    }

    // Inactive-only records.
    return {
      hasVendor: true,
      vendorApproved: false,
      vendorPending: false,
      vendorRejected: false,
      vendorType,
      vendorId: records?.[0]?.id || null,
      rejectionReason: null,
      rejectedAt: null,
    };
  };

  if (user.role === 'bakery_owner') {
    const bakeries = await prisma.bakery.findMany({
      where: vendorOwnershipWhere,
      select: {
        id: true,
        status: true,
        rejectionReason: true,
        rejectedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    return deriveVendorStatusFromRecords(bakeries, 'bakery');
  }

  const restaurants = await prisma.restaurant.findMany({
    where: vendorOwnershipWhere,
    select: {
      id: true,
      status: true,
      rejectionReason: true,
      rejectedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  });

  return deriveVendorStatusFromRecords(restaurants, 'restaurant');
};

const ensureRestaurantProfileForOwner = async (user, registrationSeed = {}) => {
  if (!user || user.role !== 'restaurant_owner') return null;

  const normalizeOptionalText = (value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const seededName =
    normalizeOptionalText(registrationSeed.restaurantName) ||
    normalizeOptionalText(registrationSeed.fullName) ||
    normalizeOptionalText(registrationSeed.username);
  const seededLocation = normalizeOptionalText(registrationSeed.location);
  const seededLogoUrl =
    normalizeOptionalText(registrationSeed.logoPath) ||
    normalizeOptionalText(registrationSeed.logoUrl);
  const seededRegistrationDocument =
    normalizeOptionalText(registrationSeed.commercialRegisterPath) ||
    normalizeOptionalText(registrationSeed.commercialRegistryUrl) ||
    normalizeOptionalText(registrationSeed.registrationDocumentUrl);
  const seededEmail = normalizeOptionalText(registrationSeed.email);

  const existingRestaurant = await prisma.restaurant.findFirst({
    where: {
      ownerId: user.id,
      deletedAt: null,
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (existingRestaurant) {
    if (existingRestaurant.status !== 'pending_approval') {
      return existingRestaurant;
    }

    const updateData = {};
    const fallbackLocation = 'Pending profile completion';
    const shouldRefreshLocation =
      !!seededLocation &&
      (
        !existingRestaurant.addressLine1 ||
        existingRestaurant.addressLine1 === fallbackLocation
      );

    if (seededName && (!existingRestaurant.name || existingRestaurant.name === 'Restaurant Owner')) {
      updateData.name = seededName;
    }
    if (shouldRefreshLocation) {
      updateData.addressLine1 = seededLocation;
      updateData.city = seededLocation;
    }
    if (seededLogoUrl && !existingRestaurant.logoUrl) {
      updateData.logoUrl = seededLogoUrl;
    }
    if (
      seededRegistrationDocument &&
      (
        !existingRestaurant.coverImageUrl ||
        existingRestaurant.coverImageUrl === existingRestaurant.logoUrl
      )
    ) {
      updateData.coverImageUrl = seededRegistrationDocument;
    }
    if (seededEmail && !existingRestaurant.email) {
      updateData.email = seededEmail;
    }

    if (Object.keys(updateData).length === 0) {
      return existingRestaurant;
    }

    return prisma.restaurant.update({
      where: { id: existingRestaurant.id },
      data: {
        ...updateData,
        updatedBy: user.id,
      },
    });
  }

  const fallbackName =
    seededName ||
    (user.fullName && user.fullName.trim()) ||
    (user.username && user.username.trim()) ||
    'Restaurant Owner';
  const fallbackPhone =
    (user.phoneNumber && user.phoneNumber.trim()) || '0000000000';
  const fallbackLocation = seededLocation || 'Pending profile completion';

  return prisma.restaurant.create({
    data: {
      name: fallbackName,
      description:
        'Auto-created pending profile. Please complete restaurant details.',
      cuisineType: 'General',
      addressLine1: fallbackLocation,
      city: fallbackLocation,
      postalCode: '00000',
      country: 'Jordan',
      phoneNumber: fallbackPhone,
      email: seededEmail || user.email || null,
      logoUrl: seededLogoUrl,
      coverImageUrl: seededRegistrationDocument,
      status: 'pending_approval',
      ownerId: user.id,
      createdBy: user.id,
    },
  });
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
    const {
      username,
      email,
      password,
      fullName,
      phoneNumber,
      role,
      location,
      logoPath,
      commercialRegisterPath,
      commercialRegistryUrl,
      registrationDocumentUrl,
      restaurantName,
    } = req.body;
    const deviceToken = resolveDeviceToken(req.body);
    const platform = req.body.platform || req.body.devicePlatform || null;
    const requiresFullCredentials = role === 'restaurant_owner';
    const normalizedUsername =
      typeof username === 'string' ? username.trim() : username;
    const normalizedEmail =
      typeof email === 'string' ? email.trim().toLowerCase() : email;
    const normalizedPassword =
      typeof password === 'string' ? password.trim() : password;

    if (
      requiresFullCredentials &&
      (
        typeof normalizedUsername !== 'string' || normalizedUsername.length === 0 ||
        typeof normalizedEmail !== 'string' || normalizedEmail.length === 0 ||
        typeof normalizedPassword !== 'string' || normalizedPassword.length === 0
      )
    ) {
      return res.status(400).json({
        status: 'fail',
        message: 'Restaurant owner registration requires username, email, and password',
      });
    }

    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
    const uniqueChecks = [];

    if (normalizedEmail) uniqueChecks.push({ email: normalizedEmail });
    if (normalizedUsername) uniqueChecks.push({ username: normalizedUsername });
    if (normalizedPhoneNumber) {
      uniqueChecks.push({ phoneNumber: normalizedPhoneNumber });
    }

    if (uniqueChecks.length === 0) {
      return res.status(400).json({
        status: 'fail',
        message: 'At least one identifier (email, username, or phone number) is required',
      });
    }

    // Check if user already exists (email/username/phone)
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: uniqueChecks,
      },
    });

    if (existingUser) {
      if (existingUser.deletedAt) {
        return res.status(403).json({
          status: 'fail',
          message: 'Your account is suspended. Please contact support.',
        });
      }

      const verificationId =
        normalizedPhoneNumber ||
        existingUser.phoneNumber ||
        normalizedEmail ||
        existingUser.email ||
        normalizedUsername ||
        existingUser.username;

      if (!verificationId) {
        return res.status(400).json({
          status: 'fail',
          message: 'Unable to determine verification target',
        });
      }

      if (existingUser.role === 'restaurant_owner') {
        await ensureRestaurantProfileForOwner(existingUser, {
          restaurantName,
          username: normalizedUsername || existingUser.username,
          fullName: fullName || existingUser.fullName,
          location,
          logoPath,
          commercialRegisterPath,
          commercialRegistryUrl,
          registrationDocumentUrl,
          email: normalizedEmail || existingUser.email,
        });
      }

      const generatedOtp = generateOtpCode();
      const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          otp: generatedOtp,
          otpExpiry,
        },
      });

      if (deviceToken) {
        await upsertDeviceToken(existingUser.id, deviceToken, platform);
      }

      if (normalizedPhoneNumber || existingUser.phoneNumber) {
        const targetPhone = normalizedPhoneNumber || existingUser.phoneNumber;
        try {
          await sendOTPviaSMS(targetPhone, generatedOtp);
        } catch (smsError) {
          console.error('Error sending signup OTP SMS to existing user:', smsError);
        }
      }

      try {
        const pushResult = await sendOtpPushToUserDevices({
          userId: existingUser.id,
          deviceToken,
          otpCode: generatedOtp,
          purpose: 'registration',
          identifier: verificationId?.toString() || '',
        });
        if (pushResult.success) {
          console.log(
            `✅ Registration OTP push notification sent successfully to ${pushResult.successCount || 0} device(s)`
          );
        } else if ((pushResult.attempted || 0) > 0) {
          console.warn(`⚠️  Failed to send registration OTP push: ${pushResult.error || 'Unknown error'}`);
        }
      } catch (pushError) {
        console.error(
          '❌ Error sending registration OTP push notification:',
          pushError
        );
      }

      await createOtpNotification({
        userId: existingUser.id,
        otpCode: generatedOtp,
        purpose: 'registration',
        identifier: verificationId,
      });

      return res.status(200).json({
        status: 'success',
        data: {
          user: sanitizeUser(existingUser),
          verification_id: verificationId,
          verificationId,
          expiresAt: otpExpiry,
          ...(process.env.NODE_ENV !== 'production' && { otp: generatedOtp }),
        },
        message: `OTP sent to ${verificationId}`,
      });
    }

    // For non-vendor OTP flows, we still allow generated passwords.
    const passwordToStore = requiresFullCredentials
      ? normalizedPassword
      : (normalizedPassword || Math.random().toString(36).slice(-12));

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(passwordToStore, salt);

    // Create new user
    const user = await prisma.user.create({
      data: {
        username: normalizedUsername,
        email: normalizedEmail,
        password: hashedPassword,
        fullName,
        phoneNumber: normalizedPhoneNumber,
        role: role || 'customer',
        otp: generateOtpCode(),
        otpExpiry: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
      }
    });

    if (deviceToken) {
      await upsertDeviceToken(user.id, deviceToken, platform);
    }

    if (user.role === 'restaurant_owner') {
      await ensureRestaurantProfileForOwner(user, {
        restaurantName,
        username: normalizedUsername,
        fullName,
        location,
        logoPath,
        commercialRegisterPath,
        commercialRegistryUrl,
        registrationDocumentUrl,
        email: normalizedEmail,
      });
    }

    if (normalizedPhoneNumber) {
      try {
        await sendOTPviaSMS(normalizedPhoneNumber, user.otp);
      } catch (smsError) {
        console.error('Error sending signup OTP SMS:', smsError);
      }
    }

    try {
      const pushResult = await sendOtpPushToUserDevices({
        userId: user.id,
        deviceToken,
        otpCode: user.otp,
        purpose: 'registration',
        identifier: (
          normalizedPhoneNumber || normalizedEmail || normalizedUsername ||
          user.phoneNumber || user.email || ''
        ).toString(),
      });
      if (pushResult.success) {
        console.log(
          `✅ Registration OTP push notification sent successfully to ${pushResult.successCount || 0} device(s)`
        );
      } else if ((pushResult.attempted || 0) > 0) {
        console.warn(`⚠️  Failed to send registration OTP push: ${pushResult.error || 'Unknown error'}`);
      }
    } catch (pushError) {
      console.error(
        '❌ Error sending registration OTP push notification:',
        pushError
      );
    }

    const verificationId =
      normalizedPhoneNumber || normalizedEmail || normalizedUsername || user.phoneNumber || user.email;

    await createOtpNotification({
      userId: user.id,
      otpCode: user.otp,
      purpose: 'registration',
      identifier: verificationId,
    });

    return res.status(201).json({
      status: 'success',
      data: {
        user: sanitizeUser(user),
        verification_id: verificationId,
        verificationId,
        expiresAt: user.otpExpiry,
        ...(process.env.NODE_ENV !== 'production' && { otp: user.otp }),
      },
      message: `OTP sent to ${verificationId}`,
    });
  } catch (error) {
    console.error('Registration error:', error);

    // Handle unique constraint violations gracefully
    if (error.code === 'P2002' && Array.isArray(error.meta?.target)) {
      const target = error.meta.target;
      const field = target.includes('phone_number') ? 'phone number' :
                    target.includes('email') ? 'email' :
                    target.includes('username') ? 'username' : 'field';
      return res.status(400).json({
        status: 'fail',
        message: `User with this ${field} already exists`,
      });
    }

    return res.status(500).json({
      status: 'error',
      message: 'An error occurred during registration'
    });
  }
});

// Login user
router.post('/login', otpRouteLimiter, async (req, res) => {
  try {
    const { otp, purpose = 'login', password, role } = req.body;
    const requestedRole =
      typeof role === 'string' ? role.trim().toLowerCase() : '';
    const { emailToCheck, usernameToCheck, phoneToCheck } =
      resolveIdentifiers(req.body);

    if (!emailToCheck && !usernameToCheck && !phoneToCheck) {
      return res.status(400).json({
        status: 'fail',
        message: 'Please provide email, username, or phone number',
      });
    }

    const user = await findUserByIdentifiers(
      emailToCheck,
      usernameToCheck,
      phoneToCheck,
      requestedRole
    );

    if (!user) {
      return res.status(401).json({
        status: 'fail',
        message: 'Invalid credentials',
      });
    }

    if (requestedRole && user.role.toLowerCase() !== requestedRole) {
      return res.status(403).json({
        status: 'fail',
        message:
          `This account is registered as ${user.role}. ` +
          `Please use the ${user.role} flow from role selection.`,
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
    const deviceToken = resolveDeviceToken(req.body);
    const platform = req.body.platform || req.body.devicePlatform || null;

    if (!otp && !password) {
      // Remove vendor eligibility check before OTP to allow all users to receive OTP
      // Vendor status will be checked after OTP verification if needed

      const rateKey = phoneToCheck || emailToCheck || usernameToCheck;
      const limiterKey = [rateKey, deviceToken && `dev:${deviceToken}`].filter(Boolean).join('|');
      if (!(await canRequestOtp(limiterKey))) {
        await logUserSecurityEvent({
          prisma,
          req,
          userId: user.id,
          eventType: 'otp_request_blocked',
          status: 'rate_limited',
          identifier: identifier?.toString() || null,
          metadata: { purpose: 'login' },
        });
        return res.status(429).json({
          status: 'fail',
          message: 'Too many OTP requests. Please try again later.',
        });
      }

      const generatedOtp = generateOtpCode();
      const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          otp: generatedOtp,
          otpExpiry,
        },
      });

      await logUserSecurityEvent({
        prisma,
        req,
        userId: user.id,
        eventType: 'otp_requested',
        status: 'generated',
        identifier: identifier?.toString() || null,
        metadata: { purpose: 'login' },
      });

      // Persist device token if provided (for future push sends)
      if (deviceToken) {
        await upsertDeviceToken(user.id, deviceToken, platform);
      }

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

      try {
        const pushResult = await sendOtpPushToUserDevices({
          userId: user.id,
          deviceToken,
          otpCode: generatedOtp,
          purpose,
          identifier: identifier?.toString() || '',
        });
        if (pushResult.success) {
          console.log(
            `✅ OTP push notification sent successfully to ${pushResult.successCount || 0} device(s)`
          );
        } else if ((pushResult.attempted || 0) > 0) {
          console.warn(`⚠️  Failed to send OTP push: ${pushResult.error || 'Unknown error'}`);
        }
      } catch (pushError) {
        console.error('❌ Error sending OTP push notification:', pushError);
      }

      await createOtpNotification({
        userId: user.id,
        otpCode: generatedOtp,
        purpose,
        identifier: identifier?.toString() || '',
      });

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

    // Password login path (if password provided)
    if (password) {
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ status: 'fail', message: 'Invalid credentials' });
      }
    } else {
      const now = new Date();
      if (user.otp !== otp || user.otpExpiry < now) {
        return res.status(400).json({
          status: 'fail',
          message: 'Invalid or expired OTP',
        });
      }
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

      let vendorStatus = null;
      try {
        vendorStatus = await resolveVendorStatusForUser(updatedUser);

        // Keep restaurant-owner flow aligned with bakery-style approval gating:
        // if account exists but restaurant profile is missing, provision
        // a pending profile so user lands in approval flow instead of
        // repeatedly returning to registration.
        if (
          updatedUser.role === 'restaurant_owner' &&
          (!vendorStatus || !vendorStatus.hasVendor)
        ) {
          await ensureRestaurantProfileForOwner(updatedUser);
          vendorStatus = await resolveVendorStatusForUser(updatedUser);
        }

        if (vendorStatus) {
          console.log(`[DEBUG] Vendor status for user ${updatedUser.id}:`, vendorStatus);
        }
      } catch (error) {
        console.log(`[DEBUG] Error checking vendor status: ${error.message}`);
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

    const vendorStatus = await resolveVendorStatusForUser(updatedUser);
    const data = issueAuthResponse(updatedUser);
    return res.status(200).json({
      status: 'success',
      message: 'OTP verified successfully',
      is_verified: true,
      data: {
        ...data,
        ...(vendorStatus && { vendorStatus }),
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

router.post('/resend-otp', otpRouteLimiter, async (req, res) => {
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

    const deviceToken = resolveDeviceToken(req.body);
    const platform = req.body.platform || req.body.devicePlatform || null;

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

    const rateKey = phoneToCheck || emailToCheck || usernameToCheck;
    const limiterKey = [rateKey, deviceToken && `dev:${deviceToken}`].filter(Boolean).join('|');
    if (!(await canRequestOtp(limiterKey))) {
      await logUserSecurityEvent({
        prisma,
        req,
        userId: user.id,
        eventType: 'otp_request_blocked',
        status: 'rate_limited',
        identifier: phoneToCheck || emailToCheck || usernameToCheck || null,
        metadata: { purpose },
      });
      return res.status(429).json({
        status: 'fail',
        message: 'Too many OTP requests. Please try again later.',
      });
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

    await logUserSecurityEvent({
      prisma,
      req,
      userId: user.id,
      eventType: 'otp_requested',
      status: 'generated',
      identifier: phoneToCheck || emailToCheck || usernameToCheck || null,
      metadata: { purpose },
    });

    // Persist device token if provided (for future push sends)
    if (deviceToken) {
      await upsertDeviceToken(user.id, deviceToken, platform);
    }

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

    const identifier = phoneToCheck || emailToCheck || user.phoneNumber || user.email;
    try {
      const pushResult = await sendOtpPushToUserDevices({
        userId: user.id,
        deviceToken,
        otpCode: otp,
        purpose,
        identifier: identifier?.toString() || '',
      });
      if (pushResult.success) {
        console.log(
          `✅ OTP push notification resent successfully to ${pushResult.successCount || 0} device(s)`
        );
      } else if ((pushResult.attempted || 0) > 0) {
        console.warn(`⚠️  Failed to resend OTP push: ${pushResult.error || 'Unknown error'}`);
      }
    } catch (pushError) {
      console.error('❌ Error resending OTP push notification:', pushError);
    }

    await createOtpNotification({
      userId: user.id,
      otpCode: otp,
      purpose,
      identifier:
        phoneToCheck || emailToCheck || user.phoneNumber || user.email || '',
    });

    // Enhanced OTP logging for development
    const identifierForLog = phoneToCheck || emailToCheck || user.phoneNumber || user.email;
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔐 BACKEND OTP RESENT');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`📱 Phone/Email: ${identifierForLog}`);
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

router.post('/verify-otp', otpRouteLimiter, async (req, res) => {
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
    const securityIdentifier = phoneToCheck || emailToCheck || usernameToCheck || null;

    if (!user) {
      await logUserSecurityEvent({
        prisma,
        req,
        userId: null,
        eventType: 'otp_verify_failed',
        status: 'user_not_found',
        identifier: securityIdentifier,
        metadata: { purpose },
      });
      return res.status(400).json({ status: 'fail', message: 'User not found' });
    }

    const failedAttempts = await countRecentFailedOtpAttempts({
      userId: user.id,
      identifier: securityIdentifier,
    });
    if (failedAttempts >= OTP_MAX_FAILED_ATTEMPTS) {
      await logUserSecurityEvent({
        prisma,
        req,
        userId: user.id,
        eventType: 'otp_verify_blocked',
        status: 'attempt_cap_reached',
        identifier: securityIdentifier,
        metadata: { purpose, failedAttempts },
      });
      return res.status(429).json({
        status: 'fail',
        message: 'Too many failed OTP attempts. Please request a new OTP and try again later.',
      });
    }

    if (!user.otp || !user.otpExpiry) {
      await logUserSecurityEvent({
        prisma,
        req,
        userId: user.id,
        eventType: 'otp_verify_failed',
        status: 'missing_otp',
        identifier: securityIdentifier,
        metadata: { purpose },
      });
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
      await logUserSecurityEvent({
        prisma,
        req,
        userId: user.id,
        eventType: 'otp_verify_failed',
        status: user.otpExpiry < now ? 'expired' : 'mismatch',
        identifier: securityIdentifier,
        metadata: { purpose },
      });
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid or expired OTP',
      });
    }

    let updateData = { otp: null, otpExpiry: null, isVerified: true };

    if (purpose === 'registration' && !user.isVerified) {
      updateData.isVerified = true;
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    await logUserSecurityEvent({
      prisma,
      req,
      userId: user.id,
      eventType: 'otp_verify_success',
      status: 'verified',
      identifier: securityIdentifier,
      metadata: { purpose },
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

      const vendorStatus = await resolveVendorStatusForUser(updatedUser);
      const data = issueAuthResponse(updatedUser);
      return res.status(200).json({
        status: 'success',
        data: {
          ...data,
          ...(vendorStatus && { vendorStatus }),
        },
        is_verified: true,
      });
    }

    const vendorStatus = await resolveVendorStatusForUser(updatedUser);
    const data = issueAuthResponse(updatedUser);
    return res.status(200).json({
      status: 'success',
      message: 'OTP verified successfully',
      is_verified: true,
      data: {
        ...data,
        ...(vendorStatus && { vendorStatus }),
      },
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while verifying OTP',
    });
  }
});

router.get('/approval-status', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    });

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

    const vendorStatus = await resolveVendorStatusForUser(user);
    const requiresApproval = !!(
      vendorStatus &&
      vendorStatus.hasVendor &&
      (vendorStatus.vendorPending || vendorStatus.vendorRejected)
    );

    return res.status(200).json({
      status: 'success',
      data: {
        role: user.role,
        isVerified: !!user.isVerified,
        requiresApproval,
        vendorStatus,
      },
    });
  } catch (error) {
    console.error('Approval status error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while checking approval status',
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

const handleRequestPasswordReset = async (req, res) => {
  try {
    const { emailToCheck, usernameToCheck, phoneToCheck } = resolveIdentifiers(req.body);

    if (!emailToCheck && !usernameToCheck && !phoneToCheck) {
      return res.status(400).json({
        status: 'fail',
        message: 'Please provide email, username, or phone number'
      });
    }

    const user = await findUserByIdentifiers(emailToCheck, usernameToCheck, phoneToCheck);
    if (!user) {
      // For security reasons, don't reveal if email exists or not
      return res.status(200).json({
        status: 'success',
        message: 'If your account is registered, you will receive reset instructions'
      });
    }

    const otp = generateOtpCode();
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    const verificationId = phoneToCheck || emailToCheck || usernameToCheck || user.phoneNumber || user.email;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        otp,
        otpExpiry,
      },
    });

    if (user.phoneNumber) {
      try {
        await sendOTPviaSMS(user.phoneNumber, otp);
      } catch (smsError) {
        console.error('Password reset OTP SMS error:', smsError);
      }
    }

    await createOtpNotification({
      userId: user.id,
      otpCode: otp,
      purpose: 'password_reset',
      identifier: verificationId?.toString() || '',
    });

    await logUserSecurityEvent({
      prisma,
      req,
      userId: user.id,
      eventType: 'password_reset_requested',
      status: 'otp_generated',
      identifier: verificationId?.toString() || null,
    });

    return res.status(200).json({
      status: 'success',
      data: {
        verificationId,
        expiresAt: otpExpiry,
        ...(process.env.NODE_ENV !== 'production' && { otp }),
      },
      message: 'Password reset OTP sent'
    });
  } catch (error) {
    console.error('Password reset request error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred during password reset request'
    });
  }
};

// Request password reset
router.post('/request-password-reset', otpRouteLimiter, handleRequestPasswordReset);
router.post('/forgot-password', otpRouteLimiter, handleRequestPasswordReset);

// Reset password
router.post('/reset-password', otpRouteLimiter, async (req, res) => {
  try {
    const { otp, newPassword } = req.body;
    const { emailToCheck, usernameToCheck, phoneToCheck } = resolveIdentifiers(req.body);

    if (!otp || !newPassword) {
      return res.status(400).json({
        status: 'fail',
        message: 'OTP and new password are required'
      });
    }

    const user = await findUserByIdentifiers(emailToCheck, usernameToCheck, phoneToCheck);
    if (!user || !user.otp || !user.otpExpiry) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid or expired reset OTP',
      });
    }

    const now = new Date();
    if (user.otp !== String(otp) || user.otpExpiry < now) {
      await logUserSecurityEvent({
        prisma,
        req,
        userId: user.id,
        eventType: 'password_reset_failed',
        status: user.otpExpiry < now ? 'expired_otp' : 'mismatch',
        identifier: phoneToCheck || emailToCheck || usernameToCheck || null,
      });
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid or expired reset OTP',
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(String(newPassword), salt);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        otp: null,
        otpExpiry: null,
        isVerified: true,
      },
    });

    await logUserSecurityEvent({
      prisma,
      req,
      userId: user.id,
      eventType: 'password_reset_success',
      status: 'password_updated',
      identifier: phoneToCheck || emailToCheck || usernameToCheck || null,
    });

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

    let vendorStatus = null;
    try {
      vendorStatus = await resolveVendorStatusForUser(user);
      if (vendorStatus) {
        console.log(`[DEBUG] Vendor status for user ${user.id}:`, vendorStatus);
      }
    } catch (error) {
      console.log(`[DEBUG] Error checking vendor status: ${error.message}`);
    }

    const data = issueAuthResponse(user);
    await logUserSecurityEvent({
      prisma,
      req,
      userId: user.id,
      eventType: 'firebase_login_success',
      status: 'authenticated',
      identifier: phoneNumber || email || firebaseUid || null,
      metadata: { provider: 'firebase' },
    });
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
    await logUserSecurityEvent({
      prisma,
      req,
      userId: null,
      eventType: 'firebase_login_failed',
      status: 'failed',
      identifier: null,
      metadata: {
        message: error?.message || 'Unknown firebase login error',
      },
    });
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

// Register or refresh a device token (for push notifications)
router.post('/device-token', authenticateToken, async (req, res) => {
  try {
    const token = resolveDeviceToken(req.body);
    const platform = req.body.platform || req.body.devicePlatform || null;

    if (!token) {
      return res.status(400).json({
        status: 'fail',
        message: 'deviceToken (or fcmToken) is required',
      });
    }

    const saved = await upsertDeviceToken(req.user.id, token, platform);
    return res.status(200).json({
      status: 'success',
      data: { deviceToken: saved },
      message: 'Device token saved',
    });
  } catch (error) {
    console.error('Device token save error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while saving device token',
    });
  }
});

// Delete a device token (e.g., on logout)
router.delete('/device-token', authenticateToken, async (req, res) => {
  try {
    const token = resolveDeviceToken(req.body) || resolveDeviceToken(req.query);
    if (!token) {
      return res.status(400).json({
        status: 'fail',
        message: 'deviceToken (or fcmToken) is required',
      });
    }

    if (!hasDeviceTokenModel()) {
      logMissingDeviceTokenModelOnce();
      return res.status(200).json({
        status: 'success',
        message: 'Device token removal skipped (device-token persistence disabled)',
      });
    }

    await prisma.deviceToken.deleteMany({
      where: { token, userId: req.user.id },
    });

    return res.status(200).json({
      status: 'success',
      message: 'Device token removed',
    });
  } catch (error) {
    console.error('Device token delete error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while deleting device token',
    });
  }
});

// List device tokens for the authenticated user (for multi-device management)
router.get('/device-token', authenticateToken, async (req, res) => {
  try {
    if (!hasDeviceTokenModel()) {
      logMissingDeviceTokenModelOnce();
      return res.status(200).json({
        status: 'success',
        data: { tokens: [] },
      });
    }

    const tokens = await prisma.deviceToken.findMany({
      where: { userId: req.user.id },
      orderBy: { lastUsed: 'desc' },
    });

    return res.status(200).json({
      status: 'success',
      data: { tokens },
    });
  } catch (error) {
    console.error('Device token list error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching device tokens',
    });
  }
});

module.exports = router;
