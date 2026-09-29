/**
 * Push Notification Service (FCM)
 * Shared helper for single and multicast push sends.
 *
 * Relies on Firebase Admin credentials already configured in the environment
 * (see src/services/firebaseAdmin.js for configuration options).
 */

const { initializeFirebaseAdmin, admin } = require('./firebaseAdmin');

// If true, send OTP as data-only push (no notification body) to avoid showing code in previews.
const PUSH_OTP_DATA_ONLY = process.env.PUSH_OTP_DATA_ONLY === 'true';
const MAX_MULTICAST_BATCH_SIZE = 500;
const INVALID_TOKEN_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

const buildCleanDataPayload = (data = {}) =>
  Object.fromEntries(
    Object.entries(data || {})
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, String(value)])
  );

const buildBaseMessage = (notification, data = {}) => {
  const message = {
    data: buildCleanDataPayload(data),
    android: { priority: 'high' },
    apns: { headers: { 'apns-priority': '10' } },
  };

  if (notification) {
    message.notification = notification;
  }

  return message;
};

const normalizeTokens = (tokens = []) =>
  Array.from(
    new Set(
      (Array.isArray(tokens) ? tokens : [])
        .map((token) => token?.toString().trim())
        .filter((token) => token && token.length > 0)
    )
  );

const splitIntoChunks = (items, chunkSize) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
};

/**
 * Send a push notification to a single device token using FCM.
 * @param {string} deviceToken - FCM device registration token
 * @param {{title: string, body: string}|null} notification - Notification payload
 * @param {object} data - Optional data payload (string values only)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string, errorCode?: string, invalidToken?: boolean}>}
 */
const sendPushNotification = async (deviceToken, notification, data = {}) => {
  try {
    const app = initializeFirebaseAdmin();

    if (!app) {
      return { success: false, error: 'Firebase not configured' };
    }

    const token = deviceToken?.toString().trim();
    if (!token) {
      return { success: false, error: 'Missing device token' };
    }

    const message = {
      ...buildBaseMessage(notification, data),
      token,
    };

    const messageId = await admin.messaging().send(message);
    console.log(`✅ Push sent via FCM. Message ID: ${messageId}`);

    return { success: true, messageId };
  } catch (error) {
    const errorCode = error?.code?.toString() || '';
    const invalidToken = INVALID_TOKEN_ERROR_CODES.has(errorCode);
    console.error('❌ Error sending push notification:', error.message);
    return {
      success: false,
      error: error.message,
      errorCode,
      invalidToken,
    };
  }
};

/**
 * Send a push notification to multiple device tokens using FCM multicast.
 * Handles batching, partial failures, and invalid token identification.
 *
 * @param {string[]} deviceTokens - FCM registration tokens
 * @param {{title: string, body: string}|null} notification - Notification payload
 * @param {object} data - Optional data payload
 * @returns {Promise<{
 *   success: boolean,
 *   attempted: number,
 *   successCount: number,
 *   failureCount: number,
 *   invalidTokens: string[],
 *   errors: Array<{token: string, code?: string, message: string}>
 * }>}
 */
const sendPushNotificationToMany = async (deviceTokens, notification, data = {}) => {
  const tokens = normalizeTokens(deviceTokens);
  if (!tokens.length) {
    return {
      success: true,
      attempted: 0,
      successCount: 0,
      failureCount: 0,
      invalidTokens: [],
      errors: [],
    };
  }

  try {
    const app = initializeFirebaseAdmin();
    if (!app) {
      return {
        success: false,
        attempted: tokens.length,
        successCount: 0,
        failureCount: tokens.length,
        invalidTokens: [],
        errors: [{ token: '*', message: 'Firebase not configured' }],
      };
    }

    const chunks = splitIntoChunks(tokens, MAX_MULTICAST_BATCH_SIZE);
    let successCount = 0;
    let failureCount = 0;
    const invalidTokens = [];
    const errors = [];

    for (const chunk of chunks) {
      const multicastMessage = {
        ...buildBaseMessage(notification, data),
        tokens: chunk,
      };

      const response = await admin.messaging().sendEachForMulticast(multicastMessage);
      successCount += response.successCount;
      failureCount += response.failureCount;

      response.responses.forEach((result, index) => {
        if (result.success) return;
        const token = chunk[index];
        const code = result.error?.code?.toString();
        const message = result.error?.message?.toString() || 'Unknown push error';

        errors.push({ token, code, message });
        if (code && INVALID_TOKEN_ERROR_CODES.has(code)) {
          invalidTokens.push(token);
        }
      });
    }

    return {
      success: failureCount === 0,
      attempted: tokens.length,
      successCount,
      failureCount,
      invalidTokens: Array.from(new Set(invalidTokens)),
      errors,
    };
  } catch (error) {
    console.error('❌ Error sending multicast push notification:', error.message);
    return {
      success: false,
      attempted: tokens.length,
      successCount: 0,
      failureCount: tokens.length,
      invalidTokens: [],
      errors: [{ token: '*', code: error?.code, message: error.message }],
    };
  }
};

/**
 * Convenience helper to send an OTP code via push notification.
 * @param {string} deviceToken - FCM device registration token
 * @param {string} otpCode - The OTP code to send
 * @param {string} purpose - Why the OTP is issued (login, registration, etc.)
 * @param {string} identifier - Human friendly identifier (email/phone)
 */
const sendOtpPush = async (deviceToken, otpCode, purpose = 'login', identifier = '') => {
  const title = 'Your verification code';
  const body = `Khubzati code: ${otpCode} (valid for 10 minutes)`;

  const notificationPayload = PUSH_OTP_DATA_ONLY ? null : { title, body };

  return sendPushNotification(deviceToken, notificationPayload, {
    otp: otpCode,
    purpose,
    identifier,
    message: body,
  });
};

/**
 * Convenience helper to send an OTP code to multiple device tokens.
 * @param {string[]} deviceTokens - FCM device registration tokens
 * @param {string} otpCode - The OTP code to send
 * @param {string} purpose - Why the OTP is issued (login, registration, etc.)
 * @param {string} identifier - Human friendly identifier (email/phone)
 */
const sendOtpPushToMany = async (deviceTokens, otpCode, purpose = 'login', identifier = '') => {
  const title = 'Your verification code';
  const body = `Khubzati code: ${otpCode} (valid for 10 minutes)`;

  const notificationPayload = PUSH_OTP_DATA_ONLY ? null : { title, body };

  return sendPushNotificationToMany(deviceTokens, notificationPayload, {
    otp: otpCode,
    purpose,
    identifier,
    message: body,
  });
};

module.exports = {
  sendPushNotification,
  sendPushNotificationToMany,
  sendOtpPush,
  sendOtpPushToMany,
};
