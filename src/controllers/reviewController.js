const { createApiResponse } = require("../utils/responseHandler");
const enMessages = require("../config/messages/en.json");
const arMessages = require("../config/messages/ar.json");
const { Review, User, Product, Bakery, Restaurant, Order } = require("../db/models");
const { Op } = require("sequelize");

// GET /reviews - Get reviews (public, filterable)
exports.getReviews = async (req, res) => {
  try {
    const { productId, bakeryId, restaurantId, userId, orderId, rating, sortBy = "createdAt", order = "DESC" } = req.query;
    let whereClause = {};
    let includeClause = [
        { model: User, as: "user", attributes: ["user_id", "username"] }, // Show who wrote the review
        // Optionally include details of what is being reviewed
        { model: Product, as: "product", attributes: ["product_id", "name_en", "name_ar"], required: false },
        { model: Bakery, as: "bakery", attributes: ["bakery_id", "name_en", "name_ar"], required: false },
        { model: Restaurant, as: "restaurant", attributes: ["restaurant_id", "name_en", "name_ar"], required: false },
        { model: Order, as: "order", attributes: ["order_id"], required: false }
    ];

    if (productId) whereClause.product_id = productId;
    if (bakeryId) whereClause.bakery_id = bakeryId;
    if (restaurantId) whereClause.restaurant_id = restaurantId;
    if (userId) whereClause.user_id = userId; // Get reviews by a specific user
    if (orderId) whereClause.order_id = orderId; // Get review for a specific order
    if (rating) whereClause.rating = parseInt(rating);

    // TODO: Add pagination
    const reviews = await Review.findAll({
      where: whereClause,
      include: includeClause,
      order: [[sortBy, order.toUpperCase()]],
      // attributes: { exclude: ["product_id", "bakery_id", "restaurant_id", "user_id", "order_id"] } // Keep if useful
    });

    return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, { reviews }, true));
  } catch (error) {
    console.error("Get reviews error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// POST /reviews - Submit a new review (protected)
exports.submitReview = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { product_id, bakery_id, restaurant_id, order_id, rating, comment_en, comment_ar } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
        [{ field: "rating", message: { en: "Rating must be between 1 and 5.", ar: "التقييم يجب أن يكون بين 1 و 5."}}]
      ));
    }
    // Ensure at least one entity is being reviewed
    if (!product_id && !bakery_id && !restaurant_id && !order_id) {
        return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
            [{ message: { en: "Review must be associated with a product, bakery, restaurant, or order.", ar: "يجب ربط المراجعة بمنتج أو مخبز أو مطعم أو طلب."}}]
        ));
    }
    // Business rule: A user can review a specific product/bakery/restaurant/order only once (optional)
    // const existingReview = await Review.findOne({ where: { user_id: userId, product_id: product_id || null, bakery_id: bakery_id || null, restaurant_id: restaurant_id || null, order_id: order_id || null } });
    // if (existingReview) {
    //     return res.status(400).json(createApiResponse(enMessages.ACTION_NOT_ALLOWED, arMessages.ACTION_NOT_ALLOWED, { detail: {en: "You have already reviewed this item/service.", ar: "لقد قمت بمراجعة هذا العنصر/الخدمة بالفعل."}}, false));
    // }

    // If order_id is provided, verify the user placed that order
    if (order_id) {
        const order = await Order.findOne({ where: { order_id, user_id: userId } });
        if (!order) {
            return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
                [{ field: "order_id", message: { en: "Invalid order ID or order does not belong to user.", ar: "معرف الطلب غير صالح أو الطلب لا يخص المستخدم."}}]
            ));
        }
        // Potentially link product/bakery/restaurant from order if not provided directly
    }

    const newReview = await Review.create({
      user_id: userId,
      product_id: product_id || null,
      bakery_id: bakery_id || null,
      restaurant_id: restaurant_id || null,
      order_id: order_id || null,
      rating,
      comment_en: comment_en || null,
      comment_ar: comment_ar || null,
      // is_approved: true // Or false if moderation is needed
    });

    // TODO: Update average rating for the reviewed product/bakery/restaurant

    return res.status(201).json(createApiResponse(enMessages.REVIEW_SUBMITTED, arMessages.REVIEW_SUBMITTED, { review: newReview }, true));
  } catch (error) {
    console.error("Submit review error:", error);
    if (error.name === "SequelizeValidationError" || error.name === "SequelizeUniqueConstraintError") {
      const validationErrors = error.errors.map(err => ({ field: err.path, message: { en: err.message, ar: `خطأ في التحقق لحقل: ${err.path}` }}));
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, validationErrors));
    }
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// PUT /reviews/:reviewId - Update an existing review (protected, owner of review)
exports.updateReview = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { reviewId } = req.params;
    const { rating, comment_en, comment_ar } = req.body;

    const review = await Review.findByPk(reviewId);
    if (!review) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Review not found.", ar: "المراجعة غير موجودة."}}, false));
    }

    if (review.user_id !== userId) {
      return res.status(403).json(createApiResponse(enMessages.FORBIDDEN, arMessages.FORBIDDEN, null, false));
    }

    if (rating !== undefined) {
        if (rating < 1 || rating > 5) {
            return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
                [{ field: "rating", message: { en: "Rating must be between 1 and 5.", ar: "التقييم يجب أن يكون بين 1 و 5."}}]
            ));
        }
        review.rating = rating;
    }
    if (comment_en !== undefined) review.comment_en = comment_en;
    if (comment_ar !== undefined) review.comment_ar = comment_ar;
    // review.is_approved = false; // If updates require re-moderation

    await review.save();
    // TODO: Recalculate average rating for the reviewed entity

    return res.status(200).json(createApiResponse(enMessages.REVIEW_UPDATED, arMessages.REVIEW_UPDATED, { review }, true));
  } catch (error) {
    console.error("Update review error:", error);
    if (error.name === "SequelizeValidationError") {
        const validationErrors = error.errors.map(err => ({ field: err.path, message: { en: err.message, ar: `خطأ في التحقق لحقل: ${err.path}` }}));
        return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, validationErrors));
    }
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// DELETE /reviews/:reviewId - Delete a review (protected, owner of review or admin)
exports.deleteReview = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const userRole = req.user.role;
    const { reviewId } = req.params;

    const review = await Review.findByPk(reviewId);
    if (!review) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Review not found.", ar: "المراجعة غير موجودة."}}, false));
    }

    if (review.user_id !== userId && userRole !== "admin") {
      return res.status(403).json(createApiResponse(enMessages.FORBIDDEN, arMessages.FORBIDDEN, null, false));
    }

    await review.destroy();
    // TODO: Recalculate average rating for the reviewed entity

    return res.status(200).json(createApiResponse(enMessages.REVIEW_DELETED, arMessages.REVIEW_DELETED, null, true));
  } catch (error) {
    console.error("Delete review error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// PUT /admin/reviews/:reviewId/status - Admin moderate review (approve/reject)
// This is an example if moderation is implemented with an is_approved field in Review model
/*
exports.moderateReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { is_approved } = req.body; // Expecting true or false

    if (is_approved === undefined || typeof is_approved !== "boolean") {
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
        [{ field: "is_approved", message: { en: "Valid approval status (true/false) is required.", ar: "حالة الموافقة (صحيح/خطأ) مطلوبة."}}]
      ));
    }

    const review = await Review.findByPk(reviewId);
    if (!review) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Review not found.", ar: "المراجعة غير موجودة."}}, false));
    }

    review.is_approved = is_approved;
    await review.save();
    // TODO: Recalculate average rating if review is approved/unapproved

    return res.status(200).json(createApiResponse(enMessages.REVIEW_STATUS_UPDATED, arMessages.REVIEW_STATUS_UPDATED, { review }, true));
  } catch (error) {
    console.error("Moderate review error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};
*/

