const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const { protect } = require("../middleware/authMiddleware");

// All notification routes should be protected
router.get("/", protect, notificationController.getNotifications);
router.put("/:notificationId/read", protect, notificationController.markNotificationRead);
router.put("/read-all", protect, notificationController.markAllNotificationsRead);

module.exports = router;

