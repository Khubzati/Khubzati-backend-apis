process.env.NODE_ENV = 'test';
require('dotenv').config();

const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');

const secret = process.env.JWT_SECRET || 'dev-temp-secret-change-me';
const tokenFor = (user, role = user.role) => jwt.sign(
  { id: user.id, role }, secret, { expiresIn: '1h' },
);

describe('authoritative session revocation', () => {
  let admin;
  let owner;
  let bakery;
  let driver;

  beforeAll(async () => {
    const driverPassword = await bcrypt.hash('Password@123', 10);
    admin = await prisma.user.findUnique({ where: { email: process.env.ADMIN_EMAIL || 'admin@khubzati.com' } });
    owner = await prisma.user.findUnique({ where: { email: 'bakery_owner@example.com' } });
    bakery = await prisma.bakery.findFirst({ where: { ownerId: owner.id, deletedAt: null } });
    driver = await prisma.user.findUnique({ where: { email: 'driver@example.com' } });
    await prisma.user.update({ where: { id: admin.id }, data: { deletedAt: null, role: 'admin', isVerified: true } });
    await prisma.user.update({ where: { id: owner.id }, data: { deletedAt: null, role: 'bakery_owner', isVerified: true } });
    await prisma.bakery.update({ where: { id: bakery.id }, data: { status: 'approved' } });
    await prisma.user.update({
      where: { id: driver.id },
      data: { deletedAt: null, role: 'driver', isVerified: true, password: driverPassword },
    });
  });

  afterEach(async () => {
    await prisma.user.update({ where: { id: admin.id }, data: { deletedAt: null, role: 'admin', isVerified: true } });
    await prisma.user.update({ where: { id: owner.id }, data: { deletedAt: null, role: 'bakery_owner', isVerified: true } });
    await prisma.bakery.update({ where: { id: bakery.id }, data: { status: 'approved' } });
    await prisma.user.update({ where: { id: driver.id }, data: { deletedAt: null, role: 'driver', isVerified: true } });
  });

  test('active administrator remains authorized', async () => {
    expect((await request(app).get('/v1/admin/auth/me')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)).status).toBe(200);
  });

  test('deleted or suspended administrator loses authority on next request', async () => {
    const token = tokenFor(admin);
    await prisma.user.update({ where: { id: admin.id }, data: { deletedAt: new Date() } });
    expect((await request(app).get('/v1/admin/auth/me')
      .set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  test('role downgrade invalidates authority encoded in old token', async () => {
    const token = tokenFor(admin);
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'customer' } });
    expect((await request(app).get('/v1/admin/auth/me')
      .set('Authorization', `Bearer ${token}`)).status).toBe(403);
  });

  test('suspended vendor owner loses selected-vendor authority', async () => {
    const token = tokenFor(owner);
    await prisma.bakery.update({ where: { id: bakery.id }, data: { status: 'suspended' } });
    expect((await request(app).get('/v1/bakery/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Vendor-ID', bakery.id)).status).toBe(403);
  });

  test('driver password login succeeds through the intentional driver role', async () => {
    const login = await request(app).post('/v1/auth/login').send({
      email: 'driver@example.com', password: 'Password@123', role: 'driver',
    });
    expect(login.status).toBe(200);
    expect(login.body.data.user.role).toBe('driver');
    expect(login.body.data.token).toBeTruthy();
  });

  test('suspended and role-changed drivers lose dashboard API authority', async () => {
    const token = tokenFor(driver);
    expect((await request(app).get('/v1/driver/availability')
      .set('Authorization', `Bearer ${token}`)).status).toBe(200);
    await prisma.user.update({ where: { id: driver.id }, data: { deletedAt: new Date() } });
    expect((await request(app).get('/v1/driver/availability')
      .set('Authorization', `Bearer ${token}`)).status).toBe(401);
    await prisma.user.update({ where: { id: driver.id }, data: { deletedAt: null, role: 'customer' } });
    expect((await request(app).get('/v1/driver/availability')
      .set('Authorization', `Bearer ${token}`)).status).toBe(403);
  });
});
