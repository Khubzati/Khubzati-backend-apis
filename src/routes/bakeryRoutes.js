const express = require("express");
const router = express.Router();
const bakeryController = require("../controllers/bakeryController");
const { protect, authorize } = require("../middleware/authMiddleware");

// Public routes
router.get("/", bakeryController.listBakeries);
router.get("/:bakeryId", bakeryController.getBakeryDetails);

// Protected routes for bakery owners / admins
router.post("/", protect, authorize("bakery_owner", "admin"), bakeryController.registerBakery);
router.put("/:bakeryId", protect, authorize("bakery_owner", "admin"), bakeryController.updateBakery);

// Admin only routes
// router.delete("/:bakeryId", protect, authorize("admin"), bakeryController.deleteBakery); // Implemented in controller as deleteBakery
router.put("/admin/:bakeryId/status", protect, authorize("admin"), bakeryController.approveRejectSuspendBakery); // Renamed route for clarity
router.delete("/admin/:bakeryId", protect, authorize("admin"), bakeryController.deleteBakery); // Admin delete route


module.exports = router;

