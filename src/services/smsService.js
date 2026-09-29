/**
 * SMS Service for sending OTP codes
 * Supports multiple providers: Twilio (recommended), Firebase Cloud Functions, or custom
 */

let twilioClient = null;

/**
 * Initialize Twilio client
 */
const initializeTwilio = () => {
    if (twilioClient) {
        return twilioClient;
    }

    try {
        // Check if Twilio is configured
        if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
            return null;
        }

        // Lazy load Twilio to avoid errors if not installed
        try {
            const twilio = require('twilio');
            twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            console.log('✅ Twilio client initialized');
            return twilioClient;
        } catch (error) {
            if (error.code === 'MODULE_NOT_FOUND') {
                console.warn('⚠️  Twilio package not installed. Install it with: npm install twilio');
                return null;
            }
            throw error;
        }
    } catch (error) {
        console.error('❌ Error initializing Twilio:', error.message);
        return null;
    }
};

/**
 * Normalize phone number to E.164 format
 * @param {string} phoneNumber - Phone number in various formats
 * @returns {string} - Normalized phone number in E.164 format
 */
const normalizePhoneNumber = (phoneNumber) => {
    if (!phoneNumber) return null;

    let normalized = phoneNumber.trim();

    // Remove all non-digit characters except +
    const digitsOnly = normalized.replace(/\D/g, '');

    // If already starts with +, return as is (assuming it's in E.164)
    if (normalized.startsWith('+')) {
        return normalized;
    }

    // Handle Jordan phone numbers (country code: +962)
    // Common formats: 0791234567, 791234567, 962791234567
    if (digitsOnly.length === 9 && digitsOnly.startsWith('7')) {
        // 9 digits starting with 7: 791234567 -> +962791234567
        return `+962${digitsOnly}`;
    } else if (digitsOnly.length === 10 && digitsOnly.startsWith('0')) {
        // 10 digits starting with 0: 0791234567 -> +962791234567
        return `+962${digitsOnly.substring(1)}`;
    } else if (digitsOnly.length === 12 && digitsOnly.startsWith('962')) {
        // 12 digits starting with 962: 962791234567 -> +962791234567
        return `+${digitsOnly}`;
    } else if (digitsOnly.length === 13 && digitsOnly.startsWith('962')) {
        // Already has +962
        return `+${digitsOnly}`;
    }

    // Default: add + if not present
    return normalized.startsWith('+') ? normalized : `+${digitsOnly}`;
};

/**
 * Send OTP via SMS using Twilio (recommended for production)
 * @param {string} phoneNumber - Phone number in any format
 * @param {string} otpCode - The OTP code to send
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
const sendOTPviaTwilio = async (phoneNumber, otpCode) => {
    try {
        const client = initializeTwilio();

        if (!client) {
            return {
                success: false,
                error: 'Twilio not configured or not installed',
            };
        }

        if (!process.env.TWILIO_PHONE_NUMBER) {
            return {
                success: false,
                error: 'TWILIO_PHONE_NUMBER not configured in environment variables',
            };
        }

        const normalizedPhone = normalizePhoneNumber(phoneNumber);
        const messageBody = `Your Khubzati verification code is: ${otpCode}. Valid for 10 minutes.`;

        // Prefer Messaging Service SID if provided; otherwise use the configured from number.
        const message = await client.messages.create({
            body: messageBody,
            to: normalizedPhone,
            ...(process.env.TWILIO_MESSAGING_SERVICE_SID
                ? { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID }
                : { from: process.env.TWILIO_PHONE_NUMBER }),
        });

        console.log(`✅ SMS sent via Twilio to ${normalizedPhone}. Message SID: ${message.sid}`);

        return {
            success: true,
            messageId: message.sid,
        };
    } catch (error) {
        console.error('❌ Error sending SMS via Twilio:', error.message);
        return {
            success: false,
            error: error.message,
        };
    }
};

/**
 * Main function to send OTP via SMS
 * Tries Twilio first, falls back to logging in development
 * @param {string} phoneNumber - Phone number
 * @param {string} otpCode - The OTP code to send
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
const sendOTPviaSMS = async (phoneNumber, otpCode) => {
    // Try Twilio first (recommended for production)
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        const result = await sendOTPviaTwilio(phoneNumber, otpCode);
        if (result.success) {
            return result;
        }
        // If Twilio fails but is configured, log the error and continue
        console.warn('⚠️  Twilio SMS failed, falling back to console log');
    }

    // Fallback: Log OTP in development (for testing without SMS service)
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📱 SMS NOT SENT (No SMS service configured)');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`📞 Phone: ${normalizedPhone}`);
    console.log(`🔑 OTP CODE: ${otpCode}`);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('💡 To enable SMS sending:');
    console.log('   1. Install Twilio: npm install twilio');
    console.log('   2. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env');
    console.log('═══════════════════════════════════════════════════════════');

    // Return success anyway so the flow continues (OTP is still generated and stored)
    // In production, you should configure a real SMS service
    return {
        success: process.env.NODE_ENV !== 'production', // Only "succeed" in development
        error: process.env.NODE_ENV === 'production'
            ? 'SMS service not configured. Please set up Twilio or another SMS provider.'
            : 'SMS logged to console (development mode)',
    };
};

module.exports = {
    sendOTPviaSMS,
    sendOTPviaTwilio,
    normalizePhoneNumber,
};
