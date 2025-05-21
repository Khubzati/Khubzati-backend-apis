const { createApiResponse } = require("../utils/responseHandler");
const enMessages = require("../config/messages/en.json");
const arMessages = require("../config/messages/ar.json");
const { Notification, User } = require("../db/models");
const { Op } = require("sequelize");

// GET /notifications - Get notifications for the current user
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user.user_id;
    // TODO: Add pagination and filtering (e.g., unread only)
    const { unreadOnly, limit = 20, offset = 0 } = req.query;
    let whereClause = { user_id: userId };

    if (unreadOnly === 'true') {
        whereClause.is_read = false;
    }

    const notifications = await Notification.findAndCountAll({
      where: whereClause,
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, 
        { 
            notifications: notifications.rows,
            totalCount: notifications.count,
            currentPage: Math.floor(offset / limit) + 1,
            totalPages: Math.ceil(notifications.count / limit)
        }, 
        true
    ));
  } catch (error) {
    console.error("Get notifications error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// PUT /notifications/:notificationId/read - Mark a specific notification as read
exports.markNotificationRead = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { notificationId } = req.params;

    const notification = await Notification.findOne({
      where: { notification_id: notificationId, user_id: userId },
    });

    if (!notification) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Notification not found.", ar: "الإشعار غير موجود."}}, false));
    }

    if (!notification.is_read) {
        notification.is_read = true;
        notification.read_at = new Date();
        await notification.save();
    }

    return res.status(200).json(createApiResponse(enMessages.NOTIFICATION_MARKED_READ, arMessages.NOTIFICATION_MARKED_READ, { notification }, true));
  } catch (error) {
    console.error("Mark notification read error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// PUT /notifications/read-all - Mark all unread notifications for the user as read
exports.markAllNotificationsRead = async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [affectedCount] = await Notification.update(
      { is_read: true, read_at: new Date() },
      { where: { user_id: userId, is_read: false } }
    );

    return res.status(200).json(createApiResponse(enMessages.NOTIFICATIONS_MARKED_READ_ALL, arMessages.NOTIFICATIONS_MARKED_READ_ALL, { affectedCount }, true));
  } catch (error) {
    console.error("Mark all notifications read error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// This is a helper function that might be called internally by other services (e.g., order service, review service)
// Not typically exposed as a direct API endpoint for users to create arbitrary notifications.
async function createNotification(userId, type, title_en, title_ar, message_en, message_ar, related_entity_type = null, related_entity_id = null, transaction = null) {
    try {
        const notificationData = {
            user_id: userId,
            type,
            title_en,
            title_ar,
            message_en,
            message_ar,
            related_entity_type,
            related_entity_id
        };
        const notification = await Notification.create(notificationData, { transaction });
        // TODO: Implement push notifications (e.g., Firebase Cloud Messaging, WebSockets) if needed
        console.log(`Notification created for user ${userId}: ${title_en}`);
        return notification;
    } catch (error) {
        console.error(`Error creating notification for user ${userId}:`, error);
        // Decide how to handle this error - it shouldn't typically break the parent transaction
        // For now, just log it.
    }
}

// Example of how another service might use it (not part of this controller's exports)
/*
async function exampleUsage() {
    // When an order status changes to 'shipped'
    await createNotification(
        order.user_id, 
        'order_status_update', 
        'Order Shipped!', 
        'تم شحن طلبك!', 
        `Your order #${order.order_id} has been shipped.`, 
        `لقد تم شحن طلبك رقم #${order.order_id}.`,
        'order',
        order.order_id
    );
}
*/

// No DELETE endpoint for notifications usually, they might be auto-cleaned up after a certain period or archived.

