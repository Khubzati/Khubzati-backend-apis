process.env.NODE_ENV = 'test';
require('dotenv').config();

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');

describe('Multi-vendor approval status', () => {
  let user;
  let approved;
  let rejected;
  let token;

  beforeAll(async () => {
    const stamp = Date.now();
    user = await prisma.user.create({
      data: {
        username: `multi_vendor_${stamp}`,
        email: `multi_vendor_${stamp}@example.com`,
        phoneNumber: `+96274${String(stamp).slice(-7)}`,
        password: 'x',
        role: 'bakery_owner',
        isVerified: true,
      },
    });
    [approved, rejected] = await Promise.all([
      prisma.bakery.create({
        data: {
          ownerId: user.id,
          name: 'Approved Multi Vendor',
          addressLine1: 'Test',
          city: 'Amman',
          postalCode: '11118',
          country: 'Jordan',
          phoneNumber: '+962790002001',
          status: 'approved',
        },
      }),
      prisma.bakery.create({
        data: {
          ownerId: user.id,
          name: 'Rejected Multi Vendor',
          addressLine1: 'Test',
          city: 'Amman',
          postalCode: '11118',
          country: 'Jordan',
          phoneNumber: '+962790002002',
          status: 'rejected',
          rejectionReason: 'Documents are unreadable',
          rejectedAt: new Date(),
        },
      }),
    ]);
    token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET || 'dev-temp-secret-change-me',
      { expiresIn: '1h' },
    );
  });

  afterAll(async () => {
    await prisma.bakery.deleteMany({ where: { id: { in: [approved.id, rejected.id] } } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  test('returns every entity and honors explicit vendor context', async () => {
    const aggregate = await request(app)
      .get('/v1/auth/approval-status')
      .set('Authorization', `Bearer ${token}`);
    expect(aggregate.status).toBe(200);
    expect(aggregate.body.data.vendorStatus.vendorEntities).toHaveLength(2);

    const selected = await request(app)
      .get(`/v1/auth/approval-status?vendorId=${rejected.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(selected.status).toBe(200);
    expect(selected.body.data.vendorStatus.currentVendorId).toBe(rejected.id);
    expect(selected.body.data.vendorStatus.accountStatus).toBe('rejected');
    expect(selected.body.data.vendorStatus.rejectionReason).toBe('Documents are unreadable');
    expect(selected.body.data.requiresApproval).toBe(true);
  });

  test('rejects a vendor context the owner does not own', async () => {
    const response = await request(app)
      .get('/v1/auth/approval-status?vendorId=00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(404);
  });
});
