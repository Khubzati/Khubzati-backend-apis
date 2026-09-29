const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const subjectFor = (role, email) =>
  crypto.createHash('sha256').update(`${role}:${String(email).trim().toLowerCase()}`).digest('hex');

const consumeOnboardingUploads = async ({
  tx,
  userId,
  vendorId,
  role,
  email,
  purposeUrls,
}) => {
  const entries = Object.entries(purposeUrls || {}).filter(([, url]) => Boolean(url));
  if (!entries.length) return [];
  const urls = entries.map(([, url]) => String(url));
  const sessions = await tx.onboardingUploadSession.findMany({
    where: { fileUrl: { in: urls } },
  });
  if (!sessions.length) return [];

  const expectedSubject = subjectFor(role, email);
  for (const session of sessions) {
    const expectedPurpose = entries.find(([, url]) => String(url) === session.fileUrl)?.[0];
    if (
      session.subjectHash !== expectedSubject ||
      session.role !== role ||
      session.purpose !== expectedPurpose ||
      session.expiresAt <= new Date() ||
      session.consumedAt ||
      session.cleanedAt
    ) {
      const error = new Error('Onboarding upload ownership, purpose, or expiry validation failed');
      error.statusCode = 409;
      throw error;
    }
  }
  await tx.onboardingUploadSession.updateMany({
    where: { id: { in: sessions.map(({ id }) => id) }, consumedAt: null },
    data: { consumedAt: new Date(), consumedByUserId: userId, consumedVendorId: vendorId },
  });
  return sessions;
};

const cleanupExpiredOnboardingUploads = async ({ prisma, now = new Date() }) => {
  const expired = await prisma.onboardingUploadSession.findMany({
    where: {
      expiresAt: { lt: now },
      consumedAt: null,
      cleanedAt: null,
      fileUrl: { not: null },
    },
    take: 100,
  });
  const results = [];
  for (const session of expired) {
    try {
      const relative = String(session.fileUrl).replace(/^\/+/, '');
      const absolute = path.join(__dirname, '../..', relative);
      await fs.promises.unlink(absolute).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await prisma.onboardingUploadSession.update({
        where: { id: session.id },
        data: { cleanedAt: new Date(), cleanupAttempts: { increment: 1 }, cleanupError: null },
      });
      results.push({ id: session.id, cleaned: true });
    } catch (error) {
      await prisma.onboardingUploadSession.update({
        where: { id: session.id },
        data: { cleanupAttempts: { increment: 1 }, cleanupError: error.message },
      });
      results.push({ id: session.id, cleaned: false });
    }
  }
  return results;
};

module.exports = { consumeOnboardingUploads, cleanupExpiredOnboardingUploads, subjectFor };
