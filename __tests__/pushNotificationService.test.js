const { sendOtpPush } = require('../src/services/pushNotificationService');

// Mock firebase admin wrapper
jest.mock('../src/services/firebaseAdmin', () => {
  const messaging = jest.fn(() => ({
    send: jest.fn().mockResolvedValue('mock-message-id'),
  }));
  return {
    initializeFirebaseAdmin: jest.fn(() => true),
    admin: { messaging },
  };
});

describe('pushNotificationService', () => {
  it('sends OTP via push and returns success', async () => {
    const result = await sendOtpPush('fake-token', '123456', 'login', 'user@example.com');

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('mock-message-id');
  });

  it('fails gracefully when token missing', async () => {
    const result = await sendOtpPush('', '123456', 'login', 'user@example.com');
    expect(result.success).toBe(false);
  });
});
