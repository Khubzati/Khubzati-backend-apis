const logUploadAudit = async ({
  prisma,
  req,
  userId = null,
  ownerType = null,
  ownerId = null,
  fileName = null,
  fileUrl,
  mimeType = null,
  fileSize = null,
  sourceRoute = null,
}) => {
  if (!prisma || !fileUrl) return null;

  try {
    return await prisma.uploadAuditLog.create({
      data: {
        userId,
        ownerType,
        ownerId,
        fileName,
        fileUrl,
        mimeType,
        fileSize,
        sourceRoute,
        requestId: req?.requestId || null,
      },
    });
  } catch (error) {
    console.error('Upload audit write failed:', error.message);
    return null;
  }
};

module.exports = {
  logUploadAudit,
};
