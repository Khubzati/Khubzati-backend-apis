process.env.NODE_ENV = 'test';
require('dotenv').config();

const { execSync } = require('child_process');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';

describe('Notification queue', () => {
  let adminToken;
  let customer;

  beforeAll(async () => {
    execSync('node scripts/test-setup.js', { stdio: 'inherit', cwd: process.cwd() });
    const admin = await prisma.user.findUnique({
      where: { email: process.env.ADMIN_EMAIL || 'admin@khubzati.com' },
    });
    customer = await prisma.user.findUnique({ where: { email: 'customer@example.com' } });
    adminToken = jwt.sign({ id: admin.id, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
  });

  afterAll(async () => {
  });

  test('enqueues and processes in-app notification jobs', async () => {
    const enqueue = await request(app)
      .post('/v1/notifications/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: customer.id,
        eventType: 'order_ready',
        channel: 'in_app',
        title: 'Order ready',
        message: 'Your order is now ready.',
      });

    expect(enqueue.status).toBe(201);
    expect(enqueue.body?.data?.jobs?.length).toBe(1);

    const processJobs = await request(app)
      .post('/v1/notifications/jobs/process')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ limit: 10, workerId: 'jest-worker' });

    expect(processJobs.status).toBe(200);
    expect(processJobs.body?.data?.processed).toBeGreaterThanOrEqual(1);
  });
});
