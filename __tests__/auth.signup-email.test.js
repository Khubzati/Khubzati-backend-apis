process.env.NODE_ENV = 'test';
process.env.REDIS_URL = '';
process.env.SMTP_HOST = 'smtp.test';
process.env.SMTP_USER = 'sender@example.test';
process.env.SMTP_PASS = 'test-only';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
jest.mock('../src/services/smsService', () => ({ sendOTPviaSMS: jest.fn() }));
jest.mock('../src/services/pushNotificationService', () => ({ sendOtpPushToMany: jest.fn() }));
jest.mock('../src/services/notificationDispatchService', () => ({ notifyUser: jest.fn() }));
jest.mock('../src/lib/prisma', () => ({
  user: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  bakery: { findMany: jest.fn().mockResolvedValue([]) },
  userSecurityEvent: { create: jest.fn(), count: jest.fn().mockResolvedValue(0) },
  $disconnect: jest.fn(),
  $executeRawUnsafe: jest.fn().mockResolvedValue(0),
}));

const request = require('supertest');
const express = require('express');
const nodemailer = require('nodemailer');
const prisma = require('../src/lib/prisma');
const { sendOTPviaSMS } = require('../src/services/smsService');
const { sendOtpPushToMany } = require('../src/services/pushNotificationService');
const app = express();
app.use(express.json());
app.use('/auth', require('../src/routes/auth'));
const sendMail = jest.fn();
let user;

beforeEach(() => {
  user = null;
  sendMail.mockReset().mockResolvedValue({ accepted: ['owner@example.test'] });
  nodemailer.createTransport.mockReturnValue({ sendMail });
  prisma.user.findFirst.mockImplementation(async () => user);
  prisma.user.findUnique.mockImplementation(async () => user);
  prisma.user.create.mockImplementation(async ({ data }) => (user = { id: 'email-signup-user', ...data }));
  prisma.user.update.mockImplementation(async ({ data }) => (user = { ...user, ...data }));
});

const signup = () => request(app).post('/auth/register').send({
  username: 'email_bakery', email: 'Owner@Example.test', phoneNumber: '+962791112233',
  password: 'TestPassword123', role: 'bakery_owner',
});

test('signup delivers OTP only by email and verifies it using that email', async () => {
  const response = await signup();
  expect(response.status).toBe(201);
  expect(response.body.data.verificationId).toBe('owner@example.test');
  expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
    to: 'owner@example.test', text: expect.stringContaining(user.otp),
  }));
  expect(sendOTPviaSMS).not.toHaveBeenCalled();
  expect(sendOtpPushToMany).not.toHaveBeenCalled();
  const result = await request(app).post('/auth/verify-otp').send({
    emailOrPhone: 'owner@example.test', otp: user.otp, purpose: 'registration',
  });
  expect(result.status).toBe(200);
  expect(result.body.data.token).toBeTruthy();
  expect(user.isVerified).toBe(true);
  expect(user.otp).toBeNull();
});

test('registration resend uses email even when the account has a phone', async () => {
  await signup();
  sendMail.mockClear();
  const response = await request(app).post('/auth/resend-otp').send({
    emailOrPhone: user.email, purpose: 'registration',
  });
  expect(response.status).toBe(200);
  expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: user.email }));
  expect(sendOTPviaSMS).not.toHaveBeenCalled();
});

test('email failure is reported and signup can be retried for the same email', async () => {
  sendMail.mockRejectedValueOnce(new Error('SMTP unavailable'));
  expect((await signup()).status).toBe(503);
  expect((await signup()).status).toBe(200);
});

test('signup rejects an invalid email and conflicting existing account', async () => {
  const invalid = await request(app).post('/auth/register').send({
    role: 'bakery_owner', email: 'invalid',
  });
  expect(invalid.status).toBe(400);
  user = { id: 'other', role: 'bakery_owner', email: 'other@example.test' };
  expect((await signup()).status).toBe(409);
  expect(sendMail).not.toHaveBeenCalled();
});

test('SMTP configuration and recipient rejection cannot produce false success', async () => {
  const host = process.env.SMTP_HOST;
  delete process.env.SMTP_HOST;
  try {
    expect((await signup()).status).toBe(503);
  } finally {
    process.env.SMTP_HOST = host;
  }
  sendMail.mockResolvedValueOnce({ accepted: [], rejected: [user.email] });
  expect((await signup()).status).toBe(503);
});
