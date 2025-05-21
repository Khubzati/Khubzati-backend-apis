const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");
const { protect, authorize } = require("../middleware/authMiddleware");

// Public routes
router.get("/", productController.listProducts);
router.get("/:productId", productController.getProductDetails);

// Protected routes for bakery/restaurant owners or admins
router.post("/", protect, authorize("bakery_owner", "restaurant_owner", "admin"), productController.addProduct);
router.put("/:productId", protect, authorize("bakery_owner", "restaurant_owner", "admin"), productController.updateProduct);
router.delete("/:productId", protect, authorize("bakery_owner", "restaurant_owner", "admin"), productController.deleteProduct);

module.exports = router;

