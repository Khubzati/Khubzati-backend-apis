const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const { protect, authorize } = require("../middleware/authMiddleware");

// User Management by Admin
router.get("/users", protect, authorize("admin"), adminController.listUsers);
router.get("/users/:userId", protect, authorize("admin"), adminController.getUserDetails);
router.put("/users/:userId/status", protect, authorize("admin"), adminController.updateUserStatus);

// Bakery Management by Admin (Approval routes are in bakeryRoutes.js with admin authorization)
// Example: router.get("/bakeries/pending", protect, authorize("admin"), adminController.listPendingBakeries);

// Restaurant Management by Admin (Approval routes are in restaurantRoutes.js with admin authorization)
// Example: router.get("/restaurants/pending", protect, authorize("admin"), adminController.listPendingRestaurants);

// Dashboard Summary
router.get("/dashboard-summary", protect, authorize("admin"), adminController.getDashboardSummary);

// General Site Settings (if applicable - placeholders)
// router.get("/settings", protect, authorize("admin"), adminController.getSiteSettings);
// router.put("/settings", protect, authorize("admin"), adminController.updateSiteSettings);

module.exports = router;

