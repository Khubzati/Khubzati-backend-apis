const express = require("express");
const router = express.Router();
const cartController = require("../controllers/cartController");
const { protect } = require("../middleware/authMiddleware");

// All cart routes should be protected as they are user-specific
router.get("/", protect, cartController.getCart);
router.post("/items", protect, cartController.addItemToCart);
router.put("/items/:cartItemId", protect, cartController.updateCartItem);
router.delete("/items/:cartItemId", protect, cartController.removeItemFromCart);
router.delete("/", protect, cartController.clearCart);

module.exports = router;

