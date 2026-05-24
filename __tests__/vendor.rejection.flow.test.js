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

describe('Vendor rejection + document resubmission flow', () => {
  let admin;
  let bakeryOwner;
  let adminToken;
  let bakeryOwnerToken;
  const createdBakeryIds = [];

  beforeAll(async () => {
    execSync('node scripts/test-setup.js', { stdio: 'inherit', cwd: process.cwd() });

    admin = await prisma.user.findUnique({
      where: { email: process.env.ADMIN_EMAIL || 'admin@khubzati.com' },
    });
    bakeryOwner = await prisma.user.findUnique({
      where: { email: 'bakery_owner@example.com' },
    });

    adminToken = asToken(admin);
    bakeryOwnerToken = asToken(bakeryOwner);
  });

  afterEach(async () => {
    if (createdBakeryIds.length > 0) {
      await prisma.bakery.deleteMany({
        where: { id: { in: createdBakeryIds.splice(0, createdBakeryIds.length) } },
      });
    }
  });

  test('reject requires reason and persists rejection metadata', async () => {
    const bakery = await prisma.bakery.create({
      data: {
        name: `Reject Flow Bakery ${Date.now()}`,
        description: 'Pending approval bakery for rejection flow test',
        addressLine1: 'Test Street',
        city: 'Amman',
        postalCode: '11118',
        country: 'Jordan',
        phoneNumber: '+962790000000',
        email: `reject_flow_${Date.now()}@example.com`,
        ownerId: bakeryOwner.id,
        status: 'pending_approval',
        createdBy: bakeryOwner.id,
      },
    });
    createdBakeryIds.push(bakery.id);

    const missingReasonRes = await request(app)
      .put(`/v1/admin/vendors/${bakery.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: '' });

    expect(missingReasonRes.status).toBe(400);

    const rejectionReason = 'Logo is blurry, please upload a clear version.';
    const rejectRes = await request(app)
      .put(`/v1/admin/vendors/${bakery.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: rejectionReason });

    expect(rejectRes.status).toBe(200);

    const rejectedBakery = await prisma.bakery.findUnique({ where: { id: bakery.id } });
    expect(rejectedBakery?.status).toBe('rejected');
    expect(rejectedBakery?.rejectionReason).toBe(rejectionReason);
    expect(rejectedBakery?.rejectedAt).toBeTruthy();

    const approvalStatusRes = await request(app)
      .get('/v1/auth/approval-status')
      .set('Authorization', `Bearer ${bakeryOwnerToken}`);

    expect(approvalStatusRes.status).toBe(200);
    expect(approvalStatusRes.body?.data?.requiresApproval).toBe(true);
    expect(approvalStatusRes.body?.data?.vendorStatus?.hasVendor).toBe(true);
    expect(approvalStatusRes.body?.data?.vendorStatus?.vendorRejected).toBe(true);
    expect(approvalStatusRes.body?.data?.vendorStatus?.vendorId).toBe(bakery.id);
    expect(approvalStatusRes.body?.data?.vendorStatus?.rejectionReason).toBe(
      rejectionReason,
    );
  });

  test('owner resubmitting rejected documents moves status back to pending', async () => {
    const bakery = await prisma.bakery.create({
      data: {
        name: `Resubmit Flow Bakery ${Date.now()}`,
        description: 'Rejected bakery awaiting document resubmission',
        addressLine1: 'Resubmit Street',
        city: 'Amman',
        postalCode: '11118',
        country: 'Jordan',
        phoneNumber: '+962791111111',
        email: `resubmit_flow_${Date.now()}@example.com`,
        ownerId: bakeryOwner.id,
        status: 'rejected',
        rejectionReason: 'Missing commercial registry document.',
        rejectedAt: new Date(),
        createdBy: bakeryOwner.id,
      },
    });
    createdBakeryIds.push(bakery.id);

    const resubmitRes = await request(app)
      .put(`/v1/bakeries/${bakery.id}`)
      .set('Authorization', `Bearer ${bakeryOwnerToken}`)
      .send({
        logoUrl: '/uploads/sample.txt',
        commercialRegistryUrl: '/uploads/sample.txt',
      });

    expect(resubmitRes.status).toBe(200);
    expect(resubmitRes.body?.data?.bakery?.status).toBe('pending_approval');

    const updatedBakery = await prisma.bakery.findUnique({ where: { id: bakery.id } });
    expect(updatedBakery?.status).toBe('pending_approval');
    expect(updatedBakery?.rejectionReason).toBeNull();
    expect(updatedBakery?.rejectedAt).toBeNull();
  });
});
