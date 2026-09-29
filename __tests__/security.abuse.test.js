process.env.NODE_ENV = 'test';
require('dotenv').config();

const { execSync } = require('child_process');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const app = require('../src/app');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';

describe('Security abuse scenarios', () => {
  let customer;
  let admin;
  let bakeryOwner;
  let customerToken;
  let bakeryToken;
  let forgedToken;
  const createdPayoutIds = [];

  beforeAll(async () => {
    execSync('node scripts/test-setup.js', { stdio: 'inherit', cwd: process.cwd() });

    customer = await prisma.user.findUnique({ where: { email: 'customer@example.com' } });
    admin = await prisma.user.findUnique({ where: { email: process.env.ADMIN_EMAIL || 'admin@khubzati.com' } });
    bakeryOwner = await prisma.user.findUnique({ where: { email: 'bakery_owner@example.com' } });

    customerToken = jwt.sign({ id: customer.id, role: customer.role }, JWT_SECRET, { expiresIn: '1h' });
    bakeryToken = jwt.sign({ id: bakeryOwner.id, role: bakeryOwner.role }, JWT_SECRET, { expiresIn: '1h' });
    forgedToken = jwt.sign({ id: admin.id, role: 'admin' }, 'wrong-secret', { expiresIn: '1h' });
  });

  afterAll(async () => {
    if (createdPayoutIds.length > 0) {
      await prisma.payoutRequest.deleteMany({
        where: { id: { in: createdPayoutIds } },
      });
    }
  });

  test('rejects forged JWT signature on protected endpoint', async () => {
    const res = await request(app)
      .get('/v1/orders')
      .set('Authorization', `Bearer ${forgedToken}`);

    expect([401, 403]).toContain(res.status);
  });

  test('blocks customer from admin-only finance config endpoint', async () => {
    const res = await request(app)
      .put('/v1/finance/commission-config/global')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ percentage: 10, fixedFee: 0.2, minimumFee: 0.1, currency: 'JOD' });

    expect([403, 404]).toContain(res.status);
  });

  test('blocks vendor from admin payout approval endpoint', async () => {
    const payout = await prisma.payoutRequest.create({
      data: {
        vendorId: 'test-bakery-id',
        vendorType: 'bakery',
        amount: 2,
        currency: 'JOD',
        status: 'requested',
      },
    });
    createdPayoutIds.push(payout.id);

    const res = await request(app)
      .post(`/v1/finance/payouts/${payout.id}/approve`)
      .set('Authorization', `Bearer ${bakeryToken}`)
      .send({});

    expect(res.status).toBe(403);
  });

  test('rejects unauthenticated notification job processing', async () => {
    const res = await request(app)
      .post('/v1/notifications/jobs/process')
      .send({ batchSize: 5 });

    expect(res.status).toBe(401);
  });
});
