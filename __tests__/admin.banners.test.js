process.env.NODE_ENV = 'test';
require('dotenv').config();

const { execSync } = require('child_process');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const app = require('../src/app');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';

describe('Admin banner management', () => {
  let adminToken;
  let customerToken;
  let createdBannerId;

  beforeAll(async () => {
    execSync('node scripts/test-setup.js', { stdio: 'inherit', cwd: process.cwd() });
    const admin = await prisma.user.findUnique({ where: { email: 'admin@khubzati.com' } });
    const customer = await prisma.user.findUnique({ where: { email: 'customer@example.com' } });

    adminToken = jwt.sign({ id: admin.id, role: admin.role }, JWT_SECRET, { expiresIn: '1h' });
    customerToken = jwt.sign({ id: customer.id, role: customer.role }, JWT_SECRET, { expiresIn: '1h' });
  });

  afterAll(async () => {
    await prisma.banner.deleteMany({ where: { titleEn: { startsWith: 'Test Banner' } } });
  });

  test('rejects unauthenticated access to list banners', async () => {
    const res = await request(app).get('/v1/admin/banners');
    expect(res.status).toBe(401);
  });

  test('rejects non-admin access to create a banner', async () => {
    const res = await request(app)
      .post('/v1/admin/banners')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ titleEn: 'Test Banner X', titleAr: 'بانر تجريبي', imageUrl: 'https://example.com/x.png' });

    expect(res.status).toBe(403);
  });

  test('rejects creating a banner with missing required fields', async () => {
    const res = await request(app)
      .post('/v1/admin/banners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ titleEn: '', titleAr: '', imageUrl: '' });

    expect(res.status).toBe(400);
  });

  test('rejects an end date before the start date', async () => {
    const res = await request(app)
      .post('/v1/admin/banners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        titleEn: 'Test Banner Dates',
        titleAr: 'بانر تجريبي',
        imageUrl: 'https://example.com/dates.png',
        startDate: '2026-08-10',
        endDate: '2026-08-01',
      });

    expect(res.status).toBe(400);
  });

  test('admin can create a banner with full fields', async () => {
    const res = await request(app)
      .post('/v1/admin/banners')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        titleEn: 'Test Banner Full',
        titleAr: 'بانر تجريبي كامل',
        imageUrl: 'https://example.com/full.png',
        navigationTarget: '/stores/test',
        isActive: true,
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        sortPriority: 5,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.banner.titleEn).toBe('Test Banner Full');
    expect(res.body.data.banner.titleAr).toBe('بانر تجريبي كامل');
    expect(res.body.data.banner.navigationTarget).toBe('/stores/test');
    expect(res.body.data.banner.sortPriority).toBe(5);
    createdBannerId = res.body.data.banner.id;
  });

  test('created banner persists and is visible in a fresh list call', async () => {
    const res = await request(app)
      .get('/v1/admin/banners')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const found = res.body.data.banners.find((b) => b.id === createdBannerId);
    expect(found).toBeTruthy();
    expect(found.titleEn).toBe('Test Banner Full');
  });

  test('admin can update a banner (partial update)', async () => {
    const res = await request(app)
      .put(`/v1/admin/banners/${createdBannerId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data.banner.isActive).toBe(false);
    // Fields not included in the partial update must be unchanged.
    expect(res.body.data.banner.titleEn).toBe('Test Banner Full');
  });

  test('an audit log entry was written for the create action', async () => {
    const log = await prisma.auditLog.findFirst({
      where: { action: 'banner.created', entityId: createdBannerId },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).toBeTruthy();
    expect(log.actorRole).toBe('admin');
  });

  test('admin can soft-delete a banner, and it no longer appears in the list', async () => {
    const del = await request(app)
      .delete(`/v1/admin/banners/${createdBannerId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(200);

    const list = await request(app)
      .get('/v1/admin/banners')
      .set('Authorization', `Bearer ${adminToken}`);
    const found = list.body.data.banners.find((b) => b.id === createdBannerId);
    expect(found).toBeUndefined();

    // Soft-deleted, not actually gone.
    const stillInDb = await prisma.banner.findUnique({ where: { id: createdBannerId } });
    expect(stillInDb).toBeTruthy();
    expect(stillInDb.deletedAt).toBeTruthy();
  });

  test('updating a non-existent banner returns 404', async () => {
    const res = await request(app)
      .put('/v1/admin/banners/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: true });

    expect(res.status).toBe(404);
  });
});
