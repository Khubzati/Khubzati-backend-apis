const express = require('express');
const { PrismaClient } = require('../generated/prisma');
const { authenticateToken } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = express.Router();

// Submit a new review
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { rating, comment, reviewType, productId, bakeryId, restaurantId } = req.body;
    
    // Validate review type and target
    if (!reviewType || !['product', 'bakery', 'restaurant'].includes(reviewType)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Valid review type is required'
      });
    }
    
    if (reviewType === 'product' && !productId) {
      return res.status(400).json({
        status: 'fail',
        message: 'Product ID is required for product reviews'
      });
    }
    
    if (reviewType === 'bakery' && !bakeryId) {
      return res.status(400).json({
        status: 'fail',
        message: 'Bakery ID is required for bakery reviews'
      });
    }
    
    if (reviewType === 'restaurant' && !restaurantId) {
      return res.status(400).json({
        status: 'fail',
        message: 'Restaurant ID is required for restaurant reviews'
      });
    }
    
    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        status: 'fail',
        message: 'Rating must be between 1 and 5'
      });
    }
    
    // Check if user has already reviewed this item
    const existingReview = await prisma.review.findFirst({
      where: {
        userId: req.user.id,
        reviewType,
        ...(reviewType === 'product' && { productId }),
        ...(reviewType === 'bakery' && { bakeryId }),
        ...(reviewType === 'restaurant' && { restaurantId }),
        deletedAt: null
      }
    });
    
    if (existingReview) {
      return res.status(400).json({
        status: 'fail',
        message: 'You have already reviewed this item'
      });
    }
    
    // Create new review
    const review = await prisma.review.create({
      data: {
        userId: req.user.id,
        rating,
        comment,
        reviewType,
        ...(reviewType === 'product' && { productId }),
        ...(reviewType === 'bakery' && { bakeryId }),
        ...(reviewType === 'restaurant' && { restaurantId }),
        createdBy: req.user.id
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            profilePictureUrl: true
          }
        }
      }
    });
    
    // Update average rating and review count
    if (reviewType === 'product' && productId) {
      const productReviews = await prisma.review.findMany({
        where: {
          productId,
          reviewType: 'product',
          deletedAt: null
        },
        select: {
          rating: true
        }
      });
      
      const averageRating = productReviews.reduce((sum, review) => sum + review.rating, 0) / productReviews.length;
      
      await prisma.product.update({
        where: { id: productId },
        data: {
          averageRating,
          reviewCount: productReviews.length
        }
      });
    } else if (reviewType === 'bakery' && bakeryId) {
      const bakeryReviews = await prisma.review.findMany({
        where: {
          bakeryId,
          reviewType: 'bakery',
          deletedAt: null
        },
        select: {
          rating: true
        }
      });
      
      const averageRating = bakeryReviews.reduce((sum, review) => sum + review.rating, 0) / bakeryReviews.length;
      
      await prisma.bakery.update({
        where: { id: bakeryId },
        data: {
          averageRating,
          reviewCount: bakeryReviews.length
        }
      });
    } else if (reviewType === 'restaurant' && restaurantId) {
      const restaurantReviews = await prisma.review.findMany({
        where: {
          restaurantId,
          reviewType: 'restaurant',
          deletedAt: null
        },
        select: {
          rating: true
        }
      });
      
      const averageRating = restaurantReviews.reduce((sum, review) => sum + review.rating, 0) / restaurantReviews.length;
      
      await prisma.restaurant.update({
        where: { id: restaurantId },
        data: {
          averageRating,
          reviewCount: restaurantReviews.length
        }
      });
    }
    
    return res.status(201).json({
      status: 'success',
      data: {
        review
      }
    });
  } catch (error) {
    console.error('Submit review error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while submitting review'
    });
  }
});

// Update a review
router.put('/:reviewId', authenticateToken, async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { rating, comment } = req.body;
    
    // Find review
    const review = await prisma.review.findFirst({
      where: {
        id: reviewId,
        userId: req.user.id,
        deletedAt: null
      }
    });
    
    if (!review) {
      return res.status(404).json({
        status: 'fail',
        message: 'Review not found or does not belong to you'
      });
    }
    
    // Validate rating
    if (rating && (rating < 1 || rating > 5)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Rating must be between 1 and 5'
      });
    }
    
    // Update review
    const updatedReview = await prisma.review.update({
      where: { id: reviewId },
      data: {
        ...(rating !== undefined && { rating }),
        ...(comment !== undefined && { comment }),
        updatedBy: req.user.id,
        updatedAt: new Date()
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            profilePictureUrl: true
          }
        }
      }
    });
    
    // Update average rating
    if (rating && review.reviewType === 'product' && review.productId) {
      const productReviews = await prisma.review.findMany({
        where: {
          productId: review.productId,
          reviewType: 'product',
          deletedAt: null
        },
        select: {
          rating: true
        }
      });
      
      const averageRating = productReviews.reduce((sum, review) => sum + review.rating, 0) / productReviews.length;
      
      await prisma.product.update({
        where: { id: review.productId },
        data: {
          averageRating
        }
      });
    } else if (rating && review.reviewType === 'bakery' && review.bakeryId) {
      const bakeryReviews = await prisma.review.findMany({
        where: {
          bakeryId: review.bakeryId,
          reviewType: 'bakery',
          deletedAt: null
        },
        select: {
          rating: true
        }
      });
      
      const averageRating = bakeryReviews.reduce((sum, review) => sum + review.rating, 0) / bakeryReviews.length;
      
      await prisma.bakery.update({
        where: { id: review.bakeryId },
        data: {
          averageRating
        }
      });
    } else if (rating && review.reviewType === 'restaurant' && review.restaurantId) {
      const restaurantReviews = await prisma.review.findMany({
        where: {
          restaurantId: review.restaurantId,
          reviewType: 'restaurant',
          deletedAt: null
        },
        select: {
          rating: true
        }
      });
      
      const averageRating = restaurantReviews.reduce((sum, review) => sum + review.rating, 0) / restaurantReviews.length;
      
      await prisma.restaurant.update({
        where: { id: review.restaurantId },
        data: {
          averageRating
        }
      });
    }
    
    return res.status(200).json({
      status: 'success',
      data: {
        review: updatedReview
      }
    });
  } catch (error) {
    console.error('Update review error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while updating review'
    });
  }
});

// Delete a review
router.delete('/:reviewId', authenticateToken, async (req, res) => {
  try {
    const { reviewId } = req.params;
    
    // Find review
    const review = await prisma.review.findFirst({
      where: {
        id: reviewId,
        userId: req.user.id,
        deletedAt: null
      }
    });
    
    if (!review) {
      return res.status(404).json({
        status: 'fail',
        message: 'Review not found or does not belong to you'
      });
    }
    
    // Soft delete the review
    await prisma.review.update({
      where: { id: reviewId },
      data: {
        deletedAt: new Date(),
        updatedBy: req.user.id,
        updatedAt: new Date()
      }
    });
    
    // Update average rating and review count
    if (review.reviewType === 'product' && review.productId) {
      const productReviews = await prisma.review.findMany({
        where: {
          productId: review.productId,
          reviewType: 'product',
          deletedAt: null
        },
        select: {
          rating: true
        }
      });
      
      const averageRating = productReviews.length > 0
        ? productReviews.reduce((sum, review) => sum + review.rating, 0) / productReviews.length
        : 0;
      
      await prisma.product.update({
        where: { id: review.productId },
        data: {
          averageRating,
          reviewCount: productReviews.length
        }
      });
    } else if (review.reviewType === 'bakery' && review.bakeryId) {
      const bakeryReviews = await prisma.review.findMany({
        where: {
          bakeryId: review.bakeryId,
          reviewType: 'bakery',
          deletedAt: null
        },
        select: {
          rating: true
        }
      });
      
      const averageRating = bakeryReviews.length > 0
        ? bakeryReviews.reduce((sum, review) => sum + review.rating, 0) / bakeryReviews.length
        : 0;
      
      await prisma.bakery.update({
        where: { id: review.bakeryId },
        data: {
          averageRating,
          reviewCount: bakeryReviews.length
        }
      });
    } else if (review.reviewType === 'restaurant' && review.restaurantId) {
      const restaurantReviews = await prisma.review.findMany({
        where: {
          restaurantId: review.restaurantId,
          reviewType: 'restaurant',
          deletedAt: null
        },
        select: {
          rating: true
        }
      });
      
      const averageRating = restaurantReviews.length > 0
        ? restaurantReviews.reduce((sum, review) => sum + review.rating, 0) / restaurantReviews.length
        : 0;
      
      await prisma.restaurant.update({
        where: { id: review.restaurantId },
        data: {
          averageRating,
          reviewCount: restaurantReviews.length
        }
      });
    }
    
    return res.status(200).json({
      status: 'success',
      message: 'Review deleted successfully'
    });
  } catch (error) {
    console.error('Delete review error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while deleting review'
    });
  }
});

module.exports = router;
