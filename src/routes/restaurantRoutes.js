const express = require("express");
const router = express.Router();
const restaurantController = require("../controllers/restaurantController");
const { protect, authorize } = require("../middleware/authMiddleware");

// Public routes
router.get("/", restaurantController.listRestaurants);
router.get("/:restaurantId", restaurantController.getRestaurantDetails);

// Protected routes for restaurant owners / admins
router.post("/", protect, authorize("restaurant_owner", "admin"), restaurantController.registerRestaurant);
router.put("/:restaurantId", protect, authorize("restaurant_owner", "admin"), restaurantController.updateRestaurant);

// Admin only routes
router.put("/admin/:restaurantId/status", protect, authorize("admin"), restaurantController.approveRejectSuspendRestaurant);
router.delete("/admin/:restaurantId", protect, authorize("admin"), restaurantController.deleteRestaurant);

module.exports = router;

