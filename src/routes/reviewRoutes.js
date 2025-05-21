const express = require("express");
const router = express.Router();
const reviewController = require("../controllers/reviewController");
const { protect, authorize } = require("../middleware/authMiddleware");

// Public: Get reviews for a product, bakery, or restaurant
router.get("/", reviewController.getReviews); // e.g., /reviews?productId=X or /reviews?bakeryId=Y

// Protected: Submit a review
router.post("/", protect, reviewController.submitReview);

// Protected: Update/Delete own review
router.put("/:reviewId", protect, reviewController.updateReview);
router.delete("/:reviewId", protect, reviewController.deleteReview);

// Admin: Moderate reviews (if applicable - example in controller)
// router.put("/admin/:reviewId/status", protect, authorize("admin"), reviewController.moderateReview);

module.exports = router;

