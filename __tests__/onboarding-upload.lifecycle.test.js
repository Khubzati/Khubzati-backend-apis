process.env.NODE_ENV = 'test';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');
const {
  cleanupExpiredOnboardingUploads,
  subjectFor,
} = require('../src/services/onboardingUploadService');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-temp-secret-change-me';
const tokenFor = (user) =>
  jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1h' });

describe('Onboarding upload lifecycle', () => {
  let owner;
  let ownerToken;
  const fileUrls = [];

  beforeAll(async () => {
    const stamp = Date.now();
    owner = await prisma.user.create({
      data: {
        email: `upload_lifecycle_${stamp}@example.com`,
        username: `upload_lifecycle_${stamp}`,
        phoneNumber: `+96277${String(stamp).slice(-7)}`,
        password: 'test',
        role: 'bakery_owner',
        isVerified: true,
      },
    });
    ownerToken = tokenFor(owner);
  });

  afterAll(async () => {
    if (!owner) {
      await prisma.$disconnect();
      return;
    }
    await prisma.onboardingUploadSession.deleteMany({
      where: { email: owner.email },
    });
    await prisma.uploadAuditLog.deleteMany({
      where: { fileUrl: { in: fileUrls } },
    });
    await prisma.bakery.deleteMany({ where: { ownerId: owner.id } });
    await prisma.user.delete({ where: { id: owner.id } });
    await Promise.all(
      fileUrls.map((url) =>
        fs.promises
          .unlink(path.join(process.cwd(), url.replace(/^\//, '')))
          .catch(() => {}),
      ),
    );
    await prisma.$disconnect();
  });

  const upload = async (purpose = 'commercial_registry', email = owner.email) => {
    const issued = await request(app)
      .post('/v1/upload/onboarding-token')
      .send({ email, role: 'bakery_owner', purpose });
    expect(issued.status).toBe(201);
    const uploaded = await request(app)
      .post('/v1/upload/document')
      .set('x-onboarding-upload-token', issued.body.data.token)
      .attach('file', Buffer.from('%PDF-1.4 lifecycle'), `${purpose}.pdf`);
    expect(uploaded.status).toBe(200);
    fileUrls.push(uploaded.body.data.fileUrl);
    return uploaded.body.data.fileUrl;
  };

  const register = (fileUrl, suffix = '') =>
    request(app)
      .post('/v1/bakeries')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: `Lifecycle Bakery ${suffix}`,
        city: 'Amman',
        phoneNumber: '+962790001234',
        commercialRegistryUrl: fileUrl,
      });

  test('consumes a valid registration upload transactionally and prevents reuse', async () => {
    const fileUrl = await upload();
    const created = await register(fileUrl, 'valid');
    expect(created.status).toBe(201);

    const session = await prisma.onboardingUploadSession.findFirst({
      where: { fileUrl },
    });
    expect(session.consumedAt).toBeInstanceOf(Date);
    expect(session.consumedByUserId).toBe(owner.id);
    expect(session.consumedVendorId).toBe(created.body.data.bakery.id);

    const reused = await register(fileUrl, 'reuse');
    expect(reused.status).toBe(409);
    expect(
      await prisma.bakery.count({ where: { name: 'Lifecycle Bakery reuse' } }),
    ).toBe(0);
  });

  test.each([
    ['wrong purpose', 'identity_document', () => owner.email],
    ['mismatched registration identity', 'commercial_registry', () => `other_${Date.now()}@example.com`],
  ])('rejects %s and rolls registration back', async (_, purpose, email) => {
    const fileUrl = await upload(purpose, email());
    const response = await register(fileUrl, purpose);
    expect(response.status).toBe(409);
    const session = await prisma.onboardingUploadSession.findFirst({ where: { fileUrl } });
    expect(session.consumedAt).toBeNull();
  });

  test('rejects expired uploads and leaves failed registration uploads unconsumed', async () => {
    const fileUrl = await upload();
    await prisma.onboardingUploadSession.updateMany({
      where: { fileUrl },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await register(fileUrl, 'expired')).status).toBe(409);

    const unused = await upload();
    const failed = await request(app)
      .post('/v1/bakeries')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ commercialRegistryUrl: unused });
    expect(failed.status).toBe(400);
    expect(
      (await prisma.onboardingUploadSession.findFirst({ where: { fileUrl: unused } }))
        .consumedAt,
    ).toBeNull();
  });

  test('cleans expired unconsumed files, preserves consumed files, and retries failures', async () => {
    const expiredUrl = await upload();
    const consumedUrl = await upload();
    const retryUrl = '/uploads';
    const base = {
      subjectHash: subjectFor('bakery_owner', owner.email),
      email: owner.email,
      role: 'bakery_owner',
      purpose: 'commercial_registry',
      expiresAt: new Date(Date.now() - 1000),
    };
    await prisma.onboardingUploadSession.updateMany({
      where: { fileUrl: expiredUrl },
      data: { expiresAt: base.expiresAt },
    });
    await prisma.onboardingUploadSession.updateMany({
      where: { fileUrl: consumedUrl },
      data: { expiresAt: base.expiresAt, consumedAt: new Date() },
    });
    const retry = await prisma.onboardingUploadSession.create({
      data: { ...base, tokenId: `retry-${Date.now()}`, fileUrl: retryUrl },
    });

    const first = await cleanupExpiredOnboardingUploads({ prisma });
    expect(first.find(({ id }) => id === retry.id).cleaned).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), expiredUrl.replace(/^\//, '')))).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), consumedUrl.replace(/^\//, '')))).toBe(true);

    await prisma.onboardingUploadSession.update({
      where: { id: retry.id },
      data: { fileUrl: `/uploads/missing-retry-${Date.now()}.pdf` },
    });
    const second = await cleanupExpiredOnboardingUploads({ prisma });
    expect(second.find(({ id }) => id === retry.id).cleaned).toBe(true);
    expect(
      (await prisma.onboardingUploadSession.findUnique({ where: { id: retry.id } }))
        .cleanupAttempts,
    ).toBe(2);
  });
});
