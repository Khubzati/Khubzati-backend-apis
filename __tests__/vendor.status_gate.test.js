process.env.NODE_ENV = 'test';
require('dotenv').config();

const { execSync } = require('child_process');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';

const asToken = (user) =>
  jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1h' });

// Covers a Phase 4 fix: a pending/rejected vendor could previously still
// create products and manage orders after logging in. ensureBakeryOwner
// (bakery.js) and resolveManagedRestaurant (restaurants.js) now both reject
// write attempts from a non-approved vendor.
describe('Vendor status write-gate', () => {
  let bakeryOwner;
  let bakeryOwnerToken;
  let restaurantOwner;
  let restaurantOwnerToken;
  let adminToken;
  const createdBakeryIds = [];
  const createdRestaurantIds = [];
  const createdUserIds = [];

  beforeAll(async () => {
    execSync('node scripts/test-setup.js', { stdio: 'inherit', cwd: process.cwd() });

    bakeryOwner = await prisma.user.findUnique({ where: { email: 'bakery_owner@example.com' } });
    restaurantOwner = await prisma.user.findUnique({ where: { email: 'restaurant_owner@example.com' } });

    bakeryOwnerToken = asToken(bakeryOwner);
    restaurantOwnerToken = asToken(restaurantOwner);
    const admin = await prisma.user.findUnique({
      where: { email: process.env.ADMIN_EMAIL || 'admin@khubzati.com' },
    });
    adminToken = asToken(admin);
  });

  afterEach(async () => {
    if (createdBakeryIds.length) {
      const ids = createdBakeryIds.splice(0);
      await prisma.product.deleteMany({ where: { bakeryId: { in: ids } } });
      await prisma.bakery.deleteMany({ where: { id: { in: ids } } });
    }
    if (createdRestaurantIds.length) {
      const ids = createdRestaurantIds.splice(0);
      await prisma.product.deleteMany({ where: { restaurantId: { in: ids } } });
      await prisma.restaurant.deleteMany({ where: { id: { in: ids } } });
    }
    if (createdUserIds.length) {
      const ids = createdUserIds.splice(0);
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('pending_approval bakery owner cannot create a product', async () => {
    const bakery = await prisma.bakery.create({
      data: {
        ownerId: bakeryOwner.id,
        name: 'Gate Test Bakery Pending',
        addressLine1: 'Test address',
        city: 'Amman',
        postalCode: '00000',
        country: 'Jordan',
        phoneNumber: '0700000000',
        status: 'pending_approval',
        createdBy: bakeryOwner.id,
      },
    });
    createdBakeryIds.push(bakery.id);

    const res = await request(app)
      .post('/v1/bakery/products')
      .set('Authorization', `Bearer ${bakeryOwnerToken}`)
      .send({ name: 'Should be blocked', price: 1.5 });

    expect(res.status).toBe(403);
  });

  test('rejected bakery owner cannot update order status', async () => {
    const bakery = await prisma.bakery.create({
      data: {
        ownerId: bakeryOwner.id,
        name: 'Gate Test Bakery Rejected',
        addressLine1: 'Test address',
        city: 'Amman',
        postalCode: '00000',
        country: 'Jordan',
        phoneNumber: '0700000000',
        status: 'rejected',
        rejectionReason: 'test',
        rejectedAt: new Date(),
        createdBy: bakeryOwner.id,
      },
    });
    createdBakeryIds.push(bakery.id);

    const res = await request(app)
      .put('/v1/bakery/orders/00000000-0000-0000-0000-000000000000/status')
      .set('Authorization', `Bearer ${bakeryOwnerToken}`)
      .send({ status: 'preparing' });

    // Middleware blocks before the order lookup ever happens, so this must
    // be 403, not a 404 for the fake order id.
    expect(res.status).toBe(403);
  });

  test('approved bakery owner is not blocked by the status gate', async () => {
    const bakery = await prisma.bakery.create({
      data: {
        ownerId: bakeryOwner.id,
        name: 'Gate Test Bakery Approved',
        addressLine1: 'Test address',
        city: 'Amman',
        postalCode: '00000',
        country: 'Jordan',
        phoneNumber: '0700000000',
        status: 'approved',
        createdBy: bakeryOwner.id,
      },
    });
    createdBakeryIds.push(bakery.id);

    const res = await request(app)
      .post('/v1/bakery/products')
      .set('Authorization', `Bearer ${bakeryOwnerToken}`)
      .send({ name: 'Should reach validation, not the gate', price: 1.5 });

    // Not blocked by the vendor-status gate (403 must not occur here); the
    // actual business-validation outcome (200/201/400) isn't this test's
    // concern.
    expect(res.status).not.toBe(403);
  });

  test('admin suspension is distinct from rejection and blocks bakery writes', async () => {
    const isolatedOwner = await prisma.user.create({
      data: {
        username: `suspended_owner_${Date.now()}`,
        email: `suspended_owner_${Date.now()}@example.com`,
        password: 'test-only-password-hash',
        phoneNumber: `+96279${String(Date.now()).slice(-7)}`,
        role: 'bakery_owner',
        isVerified: true,
      },
    });
    createdUserIds.push(isolatedOwner.id);
    const isolatedOwnerToken = asToken(isolatedOwner);
    const bakery = await prisma.bakery.create({
      data: {
        ownerId: isolatedOwner.id,
        name: 'Gate Test Bakery Suspension',
        addressLine1: 'Test address',
        city: 'Amman',
        postalCode: '00000',
        country: 'Jordan',
        phoneNumber: '0700000000',
        status: 'approved',
        createdBy: isolatedOwner.id,
      },
    });
    createdBakeryIds.push(bakery.id);

    const suspend = await request(app)
      .put(`/v1/admin/vendors/${bakery.id}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(suspend.status).toBe(200);
    const suspended = await prisma.bakery.findUnique({ where: { id: bakery.id } });
    expect(suspended.status).toBe('suspended');
    expect(suspended.rejectedAt).toBeNull();

    const mutation = await request(app)
      .post('/v1/bakery/products')
      .set('Authorization', `Bearer ${isolatedOwnerToken}`)
      .send({ name: 'Suspended write', price: 1.5 });

    expect(mutation.status).toBe(403);

    const activate = await request(app)
      .put(`/v1/admin/vendors/${bakery.id}/activate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(activate.status).toBe(200);
    const active = await prisma.bakery.findUnique({ where: { id: bakery.id } });
    expect(active.status).toBe('approved');
  });

  test('pending_approval restaurant owner cannot create a product', async () => {
    const restaurant = await prisma.restaurant.create({
      data: {
        ownerId: restaurantOwner.id,
        name: 'Gate Test Restaurant Pending',
        addressLine1: 'Test address',
        city: 'Amman',
        postalCode: '00000',
        country: 'Jordan',
        phoneNumber: '0700000000',
        status: 'pending_approval',
        createdBy: restaurantOwner.id,
      },
    });
    createdRestaurantIds.push(restaurant.id);

    const res = await request(app)
      .post('/v1/restaurant/products')
      .set('Authorization', `Bearer ${restaurantOwnerToken}`)
      .send({ name: 'Should be blocked', price: 1.5 });

    // This endpoint's pre-existing convention for "no manageable restaurant"
    // is 409 (other endpoints in this file use 404) — either way the write
    // must be blocked, which is what actually matters here.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const created = await prisma.product.findFirst({ where: { name: 'Should be blocked' } });
    expect(created).toBeNull();
  });

  test('GET requests (read-only) are not blocked for a pending restaurant', async () => {
    const restaurant = await prisma.restaurant.create({
      data: {
        ownerId: restaurantOwner.id,
        name: 'Gate Test Restaurant Read',
        addressLine1: 'Test address',
        city: 'Amman',
        postalCode: '00000',
        country: 'Jordan',
        phoneNumber: '0700000000',
        status: 'pending_approval',
        createdBy: restaurantOwner.id,
      },
    });
    createdRestaurantIds.push(restaurant.id);

    // A pending vendor should still be able to view their own profile/status
    // (this is the intentional "log in to check status" allowance) — only
    // writes are gated.
    const res = await request(app)
      .get('/v1/restaurant/orders')
      .set('Authorization', `Bearer ${restaurantOwnerToken}`);

    expect(res.status).not.toBe(403);
  });
});
