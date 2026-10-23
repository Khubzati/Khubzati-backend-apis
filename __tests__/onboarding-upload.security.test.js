process.env.NODE_ENV = 'test';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/lib/prisma');

describe('Onboarding upload security', () => {
  const uploadedPaths = [];
  const auditedUrls = [];

  afterAll(async () => {
    await prisma.onboardingUploadSession.deleteMany({ where: { fileUrl: { in: auditedUrls } } });
    await prisma.uploadAuditLog.deleteMany({ where: { fileUrl: { in: auditedUrls } } });
    await Promise.all(uploadedPaths.map((filePath) => fs.promises.unlink(filePath).catch(() => {})));
    await prisma.$disconnect();
  });

  test('rejects missing, invalid-purpose and forged tokens', async () => {
    expect((await request(app).post('/v1/upload/document')).status).toBe(401);
    const invalidPurpose = await request(app)
      .post('/v1/upload/onboarding-token')
      .send({ email: 'owner@example.com', role: 'bakery_owner', purpose: 'anything' });
    expect(invalidPurpose.status).toBe(400);

    const forged = await request(app)
      .post('/v1/upload/document')
      .set('x-onboarding-upload-token', 'forged')
      .attach('file', Buffer.from('%PDF-1.4 test'), 'document.pdf');
    expect(forged.status).toBe(401);
  });

  test('binds a short-lived purpose token into the audit record', async () => {
    const issued = await request(app)
      .post('/v1/upload/onboarding-token')
      .send({
        email: 'new-bakery@example.com',
        role: 'bakery_owner',
        purpose: 'commercial_registry',
      });
    expect(issued.status).toBe(201);
    expect(issued.body.data.expiresInSeconds).toBeLessThanOrEqual(900);

    const uploaded = await request(app)
      .post('/v1/upload/document')
      .set('x-onboarding-upload-token', issued.body.data.token)
      .attach('file', Buffer.from('%PDF-1.4 onboarding test'), 'registry.pdf');
    expect(uploaded.status).toBe(200);
    const fileUrl = uploaded.body.data.fileUrl;
    auditedUrls.push(fileUrl);
    uploadedPaths.push(path.join(process.cwd(), fileUrl.replace(/^\//, '')));

    const audit = await prisma.uploadAuditLog.findFirst({ where: { fileUrl } });
    expect(audit.ownerType).toBe('onboarding');
    expect(audit.ownerId).toMatch(/^[a-f0-9]{64}$/);
  });
});
