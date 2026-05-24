process.env.NODE_ENV = 'test';
require('dotenv').config();

const { execSync } = require('child_process');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const app = require('../src/app');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';

describe('Admin KPI/alerts endpoint permissions', () => {
  let customerToken;
  let bakeryToken;

  beforeAll(async () => {
    execSync('node scripts/test-setup.js', { stdio: 'inherit', cwd: process.cwd() });
    const customer = await prisma.user.findUnique({ where: { email: 'customer@example.com' } });
    const bakeryOwner = await prisma.user.findUnique({ where: { email: 'bakery_owner@example.com' } });

    customerToken = jwt.sign({ id: customer.id, role: customer.role }, JWT_SECRET, { expiresIn: '1h' });
    bakeryToken = jwt.sign({ id: bakeryOwner.id, role: bakeryOwner.role }, JWT_SECRET, { expiresIn: '1h' });
  });

  afterAll(async () => {
  });

  test('rejects unauthenticated access to KPI endpoint', async () => {
    const res = await request(app).get('/v1/admin/kpis/daily');
    expect(res.status).toBe(401);
  });

  test('rejects customer access to active alerts endpoint', async () => {
    const res = await request(app)
      .get('/v1/admin/alerts/active')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(403);
  });

  test('rejects bakery owner backfill attempt', async () => {
    const res = await request(app)
      .post('/v1/admin/kpis/backfill')
      .set('Authorization', `Bearer ${bakeryToken}`)
      .send({
        fromDate: '2026-05-01',
        toDate: '2026-05-02',
      });

    expect(res.status).toBe(403);
  });

  test('rejects non-admin webhook test endpoint access', async () => {
    const res = await request(app)
      .post('/v1/admin/alerts/test-webhook')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ eventType: 'alerts.test' });

    expect(res.status).toBe(403);
  });
});
