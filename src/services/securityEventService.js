const logUserSecurityEvent = async ({
  prisma,
  req,
  userId = null,
  eventType,
  status = 'recorded',
  identifier = null,
  metadata = null,
}) => {
  if (!prisma || !eventType) return null;

  try {
    return await prisma.userSecurityEvent.create({
      data: {
        userId,
        eventType,
        status,
        identifier,
        ipAddress: req?.ip || req?.headers?.['x-forwarded-for'] || null,
        userAgent: req?.headers?.['user-agent'] || null,
        requestId: req?.requestId || null,
        metadata: metadata || null,
      },
    });
  } catch (error) {
    console.error('User security event write failed:', error.message);
    return null;
  }
};

module.exports = {
  logUserSecurityEvent,
};
