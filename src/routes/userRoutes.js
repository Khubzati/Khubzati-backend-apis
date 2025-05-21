const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const { protect } = require("../middleware/authMiddleware"); // Import protect middleware

// User Profile
router.get("/me", protect, userController.getCurrentUserProfile);
router.put("/me", protect, userController.updateCurrentUserProfile);

// User Addresses
router.get("/me/addresses", protect, userController.getUserAddresses);
router.post("/me/addresses", protect, userController.addUserAddress);
router.put("/me/addresses/:addressId", protect, userController.updateUserAddress);
router.delete("/me/addresses/:addressId", protect, userController.deleteUserAddress);

module.exports = router;

