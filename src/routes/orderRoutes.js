const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const { protect, authorize } = require("../middleware/authMiddleware");

// All order routes should be protected
router.post("/", protect, orderController.createOrder);
router.get("/", protect, orderController.listOrders); // User gets their orders, admin/owner gets relevant orders
router.get("/:orderId", protect, orderController.getOrderDetails);
router.put("/:orderId/status", protect, authorize("admin", "bakery_owner", "restaurant_owner"), orderController.updateOrderStatus);
router.post("/:orderId/cancel", protect, orderController.cancelOrder);

// Payment related to order - Placeholder, actual payment processing will be more complex
// router.post("/:orderId/payments", protect, orderController.processOrderPayment); 

module.exports = router;

