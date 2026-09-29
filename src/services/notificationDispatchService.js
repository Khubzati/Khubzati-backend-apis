const { sendPushNotificationToMany } = require('./pushNotificationService');

const normalizeUserIds = (userIds = []) =>
  Array.from(
    new Set(
      (Array.isArray(userIds) ? userIds : [userIds])
        .map((id) => id?.toString().trim())
        .filter((id) => id && id.length > 0)
    )
  );

const buildPushData = ({ notification, extraData = {} }) => ({
  type: notification.type,
  notificationId: notification.id,
  relatedId: notification.relatedId || '',
  title: notification.title,
  message: notification.message,
  ...extraData,
});

const createNotificationRecord = async ({
  prisma,
  userId,
  title,
  message,
  type = 'system',
  relatedId,
  createdBy = 'system',
}) =>
  prisma.notification.create({
    data: {
      userId,
      title,
      message,
      type,
      relatedId: relatedId || null,
      createdBy,
    },
  });

const sendPushToUser = async ({
  prisma,
  userId,
  title,
  message,
  type = 'system',
  relatedId,
  data = {},
}) => {
  try {
    const deviceTokens = await prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true },
    });

    const tokens = deviceTokens.map((entry) => entry.token).filter(Boolean);
    if (!tokens.length) {
      return {
        success: true,
        attempted: 0,
        successCount: 0,
        failureCount: 0,
        invalidTokens: [],
        errors: [],
      };
    }

    const pushResult = await sendPushNotificationToMany(
      tokens,
      { title, body: message },
      {
        type,
        relatedId: relatedId || '',
        ...data,
      }
    );

    if (pushResult.invalidTokens?.length) {
      await prisma.deviceToken.deleteMany({
        where: {
          userId,
          token: { in: pushResult.invalidTokens },
        },
      });
    }

    return pushResult;
  } catch (error) {
    console.error(`❌ Failed to send push to user ${userId}:`, error.message);
    return {
      success: false,
      attempted: 0,
      successCount: 0,
      failureCount: 0,
      invalidTokens: [],
      errors: [{ token: '*', message: error.message }],
    };
  }
};

const notifyUser = async ({
  prisma,
  userId,
  title,
  message,
  type = 'system',
  relatedId,
  createdBy = 'system',
  sendPush = true,
  data = {},
}) => {
  const result = {
    userId,
    notification: null,
    push: null,
  };

  try {
    const notification = await createNotificationRecord({
      prisma,
      userId,
      title,
      message,
      type,
      relatedId,
      createdBy,
    });
    result.notification = notification;

    if (sendPush) {
      result.push = await sendPushToUser({
        prisma,
        userId,
        title,
        message,
        type,
        relatedId: notification.relatedId || relatedId,
        data: buildPushData({
          notification,
          extraData: data,
        }),
      });
    }
  } catch (error) {
    console.error(`❌ Failed to notify user ${userId}:`, error.message);
  }

  return result;
};

const notifyUsers = async ({
  prisma,
  userIds,
  title,
  message,
  type = 'system',
  relatedId,
  createdBy = 'system',
  sendPush = true,
  data = {},
}) => {
  const normalizedUserIds = normalizeUserIds(userIds);
  const results = [];

  for (const userId of normalizedUserIds) {
    // Sequential sends keep logs easier to follow and avoid spiky FCM bursts.
    // This can be parallelized later with queueing if throughput grows.
    // eslint-disable-next-line no-await-in-loop
    const result = await notifyUser({
      prisma,
      userId,
      title,
      message,
      type,
      relatedId,
      createdBy,
      sendPush,
      data,
    });
    results.push(result);
  }

  return results;
};

module.exports = {
  notifyUser,
  notifyUsers,
};
