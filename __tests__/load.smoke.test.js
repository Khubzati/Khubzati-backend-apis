process.env.NODE_ENV = 'test';
require('dotenv').config();

const { execSync } = require('child_process');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const app = require('../src/app');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';

describe('Load smoke scenarios (CI-safe)', () => {
  let customer;
  let driver;
  let customerToken;
  let driverToken;

  beforeAll(async () => {
    execSync('node scripts/test-setup.js', { stdio: 'inherit', cwd: process.cwd() });
    customer = await prisma.user.findUnique({ where: { email: 'customer@example.com' } });
    driver = await prisma.user.findUnique({ where: { email: 'driver@example.com' } });

    customerToken = jwt.sign({ id: customer.id, role: customer.role }, JWT_SECRET, { expiresIn: '1h' });
    driverToken = jwt.sign({ id: driver.id, role: driver.role }, JWT_SECRET, { expiresIn: '1h' });
  });

  afterAll(async () => {
  });

  test('handles burst traffic on readiness endpoint without 5xx responses', async () => {
    const burstSize = 40;

    const responses = await Promise.all(
      Array.from({ length: burstSize }).map(() => request(app).get('/health')),
    );

    const failed = responses.filter((res) => res.status >= 500);
    expect(failed).toHaveLength(0);
    expect(responses.every((res) => res.status === 200)).toBe(true);
  });

  test('handles concurrent authenticated list requests for customer and driver roles', async () => {
    const customerLoad = Array.from({ length: 20 }).map(() =>
      request(app)
        .get('/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`),
    );

    const driverLoad = Array.from({ length: 20 }).map(() =>
      request(app)
        .get('/v1/driver/available-deliveries')
        .set('Authorization', `Bearer ${driverToken}`),
    );

    const responses = await Promise.all([...customerLoad, ...driverLoad]);
    const failed = responses.filter((res) => res.status >= 500);

    expect(failed).toHaveLength(0);
    expect(responses.every((res) => [200, 404].includes(res.status))).toBe(true);
  });
});
