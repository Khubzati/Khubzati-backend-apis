process.env.NODE_ENV = 'test';
require('dotenv').config();

const { execSync } = require('child_process');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const app = require('../src/app');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';
const OTP_MAX_FAILED_ATTEMPTS = Number(process.env.OTP_MAX_FAILED_ATTEMPTS || 5);

const unique = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

const createdUsers = [];
const createdAddresses = [];

const registerUser = async ({ role = 'customer' } = {}) => {
  const username = unique(`sec_${role}`);
  const email = `${username}@example.com`;
  const phoneNumber = `96279${Math.floor(1000000 + Math.random() * 8999999)}`;

  const registerRes = await request(app)
    .post('/v1/auth/register')
    .send({
      role,
      username,
      email,
      password: 'Password@123',
      fullName: 'Security Test User',
      phoneNumber,
    });

  expect([200, 201]).toContain(registerRes.status);

  const otp = registerRes.body?.data?.otp;
  expect(otp).toBeTruthy();

  const verifyRes = await request(app)
    .post('/v1/auth/verify-otp')
    .send({ email, otp, purpose: 'registration' });

  expect(verifyRes.status).toBe(200);
  const token = verifyRes.body?.data?.token;
  expect(token).toBeTruthy();

  const me = await request(app)
    .get('/v1/user/me')
    .set('Authorization', `Bearer ${token}`);

  expect(me.status).toBe(200);
  createdUsers.push(me.body?.data?.user?.id);

  return { email, token, userId: me.body?.data?.user?.id };
};

describe('Extended security regression tests', () => {
  let admin;
  let customer;
  let bakeryOwner;
  let adminToken;
  let customerToken;
  let bakeryOwnerToken;

  beforeAll(async () => {
    execSync('node scripts/test-setup.js', { stdio: 'inherit', cwd: process.cwd() });

    admin = await prisma.user.findUnique({ where: { email: process.env.ADMIN_EMAIL || 'admin@khubzati.com' } });
    customer = await prisma.user.findUnique({ where: { email: 'customer@example.com' } });
    bakeryOwner = await prisma.user.findUnique({ where: { email: 'bakery_owner@example.com' } });

    adminToken = jwt.sign({ id: admin.id, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    customerToken = jwt.sign({ id: customer.id, role: customer.role }, JWT_SECRET, { expiresIn: '1h' });
    bakeryOwnerToken = jwt.sign({ id: bakeryOwner.id, role: bakeryOwner.role }, JWT_SECRET, { expiresIn: '1h' });
  });

  afterAll(async () => {
    await prisma.address.deleteMany({ where: { id: { in: createdAddresses } } }).catch(() => null);
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } }).catch(() => null);
  });

  test('rejects invalid JWT on protected endpoint', async () => {
    const badToken = jwt.sign({ id: admin.id, role: 'admin' }, 'bad-secret', { expiresIn: '1h' });
    const res = await request(app)
      .get('/v1/orders')
      .set('Authorization', `Bearer ${badToken}`);

    expect([401, 403]).toContain(res.status);
  });

  test('upload endpoint requires auth and blocks cross-owner uploads', async () => {
    const noAuth = await request(app)
      .post('/v1/upload/document');
    expect(noAuth.status).toBe(401);

    const userA = await registerUser({ role: 'customer' });
    const userB = await registerUser({ role: 'customer' });

    const crossOwnerUpload = await request(app)
      .post('/v1/upload/document')
      .set('Authorization', `Bearer ${userA.token}`)
      .field('ownerType', 'user')
      .field('ownerId', userB.userId)
      .attach('file', `${process.cwd()}/uploads/sample.txt`);

    expect(crossOwnerUpload.status).toBe(403);
  });

  test('address takeover is blocked for other users', async () => {
    const userA = await registerUser({ role: 'customer' });
    const userB = await registerUser({ role: 'customer' });

    const createAddress = await request(app)
      .post('/v1/user/me/addresses')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({
        addressLine1: 'Sec Address',
        city: 'Amman',
        postalCode: '11118',
      });

    expect(createAddress.status).toBe(201);
    const addressId = createAddress.body?.data?.address?.id;
    createdAddresses.push(addressId);

    const takeover = await request(app)
      .put(`/v1/user/me/addresses/${addressId}`)
      .set('Authorization', `Bearer ${userB.token}`)
      .send({ city: 'Hijack' });

    expect(takeover.status).toBe(404);
  });

  test('non-admin users cannot access admin APIs', async () => {
    const customerRes = await request(app)
      .get('/v1/admin/users')
      .set('Authorization', `Bearer ${customerToken}`);

    const bakeryRes = await request(app)
      .get('/v1/admin/users')
      .set('Authorization', `Bearer ${bakeryOwnerToken}`);

    expect(customerRes.status).toBe(403);
    expect(bakeryRes.status).toBe(403);
  });

  test('OTP failed-attempt cap is enforced', async () => {
    const username = unique('otp_cap');
    const email = `${username}@example.com`;
    const phoneNumber = `96279${Math.floor(1000000 + Math.random() * 8999999)}`;

    const registerRes = await request(app)
      .post('/v1/auth/register')
      .send({
        role: 'customer',
        username,
        email,
        password: 'Password@123',
        fullName: 'OTP Cap User',
        phoneNumber,
      });

    expect([200, 201]).toContain(registerRes.status);

    for (let i = 0; i < OTP_MAX_FAILED_ATTEMPTS; i += 1) {
      const attempt = await request(app)
        .post('/v1/auth/verify-otp')
        .send({
          email,
          otp: '000000',
          purpose: 'registration',
        });

      expect([400, 429]).toContain(attempt.status);
    }

    const blocked = await request(app)
      .post('/v1/auth/verify-otp')
      .send({
        email,
        otp: '000000',
        purpose: 'registration',
      });

    expect(blocked.status).toBe(429);
  });

  test('Firebase login fallback is not allowed for missing/invalid token', async () => {
    const missingToken = await request(app)
      .post('/v1/auth/login-with-firebase')
      .send({});
    expect(missingToken.status).toBe(400);

    const invalidToken = await request(app)
      .post('/v1/auth/login-with-firebase')
      .send({ idToken: 'not-a-valid-firebase-token' });

    expect(invalidToken.status).not.toBe(200);
    expect(invalidToken.body?.data?.token).toBeFalsy();
  });

  test('OTP routes enforce request rate limits', async () => {
    const attempts = [];
    for (let i = 0; i < 40; i += 1) {
      // Keep IP constant to ensure all requests hit the same limiter key.
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post('/v1/auth/login')
        .set('x-forwarded-for', '198.51.100.77')
        .send({});
      attempts.push(res.status);
    }

    expect(attempts.some((status) => status === 429)).toBe(true);
  });

  test('admin login must not succeed with empty credentials (fallback bypass check)', async () => {
    const res = await request(app)
      .post('/v1/admin/auth/login')
      .send({});

    expect(res.status).not.toBe(200);
  });

  test('admin login rejects missing email/password fields', async () => {
    const missingEmail = await request(app)
      .post('/v1/admin/auth/login')
      .send({ password: 'Password@123' });

    const missingPassword = await request(app)
      .post('/v1/admin/auth/login')
      .send({ email: process.env.ADMIN_EMAIL || 'admin@khubzati.com' });

    expect(missingEmail.status).toBe(400);
    expect(missingPassword.status).toBe(400);
  });

  test('admin login rejects invalid credentials and has no env fallback auth', async () => {
    const wrongPassword = await request(app)
      .post('/v1/admin/auth/login')
      .send({
        email: process.env.ADMIN_EMAIL || 'admin@khubzati.com',
        password: 'WrongPassword@123',
      });

    const unknownAdmin = await request(app)
      .post('/v1/admin/auth/login')
      .send({
        email: `unknown_${Date.now()}@example.com`,
        password: 'Password@123',
      });

    expect(wrongPassword.status).toBe(401);
    expect(unknownAdmin.status).toBe(401);
  });

  test('valid admin login works only with explicit valid credentials', async () => {
    const login = await request(app)
      .post('/v1/admin/auth/login')
      .send({
        email: process.env.ADMIN_EMAIL || 'admin@khubzati.com',
        password: 'Password@123',
      });

    expect(login.status).toBe(200);
    expect(login.body?.data?.token).toBeTruthy();
    expect(login.body?.data?.user?.role).toBe('admin');
  });

  test('admin login accepts case-insensitive email matching', async () => {
    const adminEmail = String(process.env.ADMIN_EMAIL || 'admin@khubzati.com');
    const upperCasedEmail = adminEmail.toUpperCase();

    const login = await request(app)
      .post('/v1/admin/auth/login')
      .send({
        email: upperCasedEmail,
        password: 'Password@123',
      });

    expect(login.status).toBe(200);
    expect(login.body?.data?.token).toBeTruthy();
    expect(login.body?.data?.user?.email?.toLowerCase()).toBe(adminEmail.toLowerCase());
  });
});
