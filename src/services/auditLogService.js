const logAuditEvent = async ({
  prisma,
  req,
  action,
  entityType,
  entityId = null,
  metadata = null,
}) => {
  if (!prisma || !action || !entityType) return null;

  try {
    return await prisma.auditLog.create({
      data: {
        actorUserId: req?.user?.id || null,
        actorRole: req?.user?.role || null,
        action,
        entityType,
        entityId,
        requestId: req?.requestId || null,
        metadata: metadata || null,
      },
    });
  } catch (error) {
    // Audit logging must not block business operations.
    console.error('Audit log write failed:', error.message);
    return null;
  }
};

module.exports = {
  logAuditEvent,
};
