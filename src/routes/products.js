const express = require('express');
const { PrismaClient } = require('../generated/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = express.Router();

// List all products (can be filtered by bakery, restaurant, category, search term)
router.get('/', async (req, res) => {
  try {
    const { bakeryId, restaurantId, categoryId, search_term, page = 1, limit = 10 } = req.query;

    const whereClause = {
      isAvailable: true,
      deletedAt: null
    };

    if (bakeryId) {
      whereClause.bakeryId = bakeryId;
      whereClause.itemType = 'bakery';
    }

    if (restaurantId) {
      whereClause.restaurantId = restaurantId;
      whereClause.itemType = 'restaurant_menu';
    }

    if (categoryId) {
      whereClause.categoryId = categoryId;
    }

    if (search_term) {
      whereClause.OR = [
        { name: { contains: search_term, mode: 'insensitive' } },
        { description: { contains: search_term, mode: 'insensitive' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [products, totalCount] = await Promise.all([
      prisma.product.findMany({
        where: whereClause,
        include: {
          category: {
            select: {
              id: true,
              name: true,
              type: true
            }
          },
          bakery: {
            select: {
              id: true,
              name: true
            }
          },
          restaurant: {
            select: {
              id: true,
              name: true
            }
          }
        },
        take: parseInt(limit),
        skip,
        orderBy: { name: 'asc' }
      }),
      prisma.product.count({ where: whereClause })
    ]);

    return res.status(200).json({
      status: 'success',
      data: {
        products,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(totalCount / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('List products error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching products'
    });
  }
});

// Get details of a specific product
router.get('/:productId', async (req, res) => {
  try {
    const { productId } = req.params;

    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        isAvailable: true,
        deletedAt: null
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            type: true
          }
        },
        bakery: {
          select: {
            id: true,
            name: true,
            city: true
          }
        },
        restaurant: {
          select: {
            id: true,
            name: true,
            city: true,
            cuisineType: true
          }
        }
      }
    });

    if (!product) {
      return res.status(404).json({
        status: 'fail',
        message: 'Product not found'
      });
    }

    return res.status(200).json({
      status: 'success',
      data: {
        product
      }
    });
  } catch (error) {
    console.error('Get product details error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching product details'
    });
  }
});

// Add a new product (Bakery/Restaurant Owner Role)
router.post('/', authenticateToken, authorizeRole(['bakery_owner', 'restaurant_owner', 'admin']), async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      imageUrl,
      categoryId,
      itemType,
      bakeryId,
      restaurantId,
      stockQuantity,
      preparationTimeMinutes,
      dietaryInfo
    } = req.body;

    // Validate item type and ownership
    if (itemType === 'bakery') {
      if (!bakeryId) {
        return res.status(400).json({
          status: 'fail',
          message: 'Bakery ID is required for bakery items'
        });
      }

      // Check if user owns this bakery
      if (req.user.role !== 'admin') {
        const bakery = await prisma.bakery.findFirst({
          where: {
            id: bakeryId,
            ownerId: req.user.id,
            deletedAt: null
          }
        });

        if (!bakery) {
          return res.status(403).json({
            status: 'fail',
            message: 'You do not have permission to add products to this bakery'
          });
        }
      }
    } else if (itemType === 'restaurant_menu') {
      if (!restaurantId) {
        return res.status(400).json({
          status: 'fail',
          message: 'Restaurant ID is required for restaurant menu items'
        });
      }

      // Check if user owns this restaurant
      if (req.user.role !== 'admin') {
        const restaurant = await prisma.restaurant.findFirst({
          where: {
            id: restaurantId,
            ownerId: req.user.id,
            deletedAt: null
          }
        });

        if (!restaurant) {
          return res.status(403).json({
            status: 'fail',
            message: 'You do not have permission to add products to this restaurant'
          });
        }
      }
    } else {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid item type'
      });
    }

    // Create new product
    const product = await prisma.product.create({
      data: {
        name,
        description,
        price: parseFloat(price),
        imageUrl,
        categoryId,
        itemType,
        bakeryId: itemType === 'bakery' ? bakeryId : null,
        restaurantId: itemType === 'restaurant_menu' ? restaurantId : null,
        stockQuantity: stockQuantity || 0,
        preparationTimeMinutes,
        dietaryInfo,
        isAvailable: true,
        createdBy: req.user.id
      }
    });

    return res.status(201).json({
      status: 'success',
      data: {
        product
      }
    });
  } catch (error) {
    console.error('Add product error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while adding product'
    });
  }
});

// Update a product (Bakery/Restaurant Owner Role)
router.put('/:productId', authenticateToken, authorizeRole(['bakery_owner', 'restaurant_owner', 'admin']), async (req, res) => {
  try {
    const { productId } = req.params;
    const {
      name,
      description,
      price,
      imageUrl,
      categoryId,
      stockQuantity,
      preparationTimeMinutes,
      dietaryInfo,
      isAvailable
    } = req.body;

    // Find product
    const product = await prisma.product.findUnique({
      where: { id: productId }
    });

    if (!product) {
      return res.status(404).json({
        status: 'fail',
        message: 'Product not found'
      });
    }

    // Check if user is authorized to update this product
    if (req.user.role !== 'admin') {
      if (product.itemType === 'bakery') {
        const bakery = await prisma.bakery.findFirst({
          where: {
            id: product.bakeryId,
            ownerId: req.user.id,
            deletedAt: null
          }
        });

        if (!bakery) {
          return res.status(403).json({
            status: 'fail',
            message: 'You do not have permission to update this product'
          });
        }
      } else if (product.itemType === 'restaurant_menu') {
        const restaurant = await prisma.restaurant.findFirst({
          where: {
            id: product.restaurantId,
            ownerId: req.user.id,
            deletedAt: null
          }
        });

        if (!restaurant) {
          return res.status(403).json({
            status: 'fail',
            message: 'You do not have permission to update this product'
          });
        }
      }
    }

    // Update product
    const updatedProduct = await prisma.product.update({
      where: { id: productId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(price !== undefined && { price: parseFloat(price) }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(categoryId !== undefined && { categoryId }),
        ...(stockQuantity !== undefined && { stockQuantity: parseInt(stockQuantity) }),
        ...(preparationTimeMinutes !== undefined && { preparationTimeMinutes: parseInt(preparationTimeMinutes) }),
        ...(dietaryInfo !== undefined && { dietaryInfo }),
        ...(isAvailable !== undefined && { isAvailable }),
        updatedBy: req.user.id,
        updatedAt: new Date()
      }
    });

    return res.status(200).json({
      status: 'success',
      data: {
        product: updatedProduct
      }
    });
  } catch (error) {
    console.error('Update product error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while updating product'
    });
  }
});

// Delete a product (Bakery/Restaurant Owner Role)
router.delete('/:productId', authenticateToken, authorizeRole(['bakery_owner', 'restaurant_owner', 'admin']), async (req, res) => {
  try {
    const { productId } = req.params;

    // Find product
    const product = await prisma.product.findUnique({
      where: { id: productId }
    });

    if (!product) {
      return res.status(404).json({
        status: 'fail',
        message: 'Product not found'
      });
    }

    // Check if user is authorized to delete this product
    if (req.user.role !== 'admin') {
      if (product.itemType === 'bakery') {
        const bakery = await prisma.bakery.findFirst({
          where: {
            id: product.bakeryId,
            ownerId: req.user.id,
            deletedAt: null
          }
        });

        if (!bakery) {
          return res.status(403).json({
            status: 'fail',
            message: 'You do not have permission to delete this product'
          });
        }
      } else if (product.itemType === 'restaurant_menu') {
        const restaurant = await prisma.restaurant.findFirst({
          where: {
            id: product.restaurantId,
            ownerId: req.user.id,
            deletedAt: null
          }
        });

        if (!restaurant) {
          return res.status(403).json({
            status: 'fail',
            message: 'You do not have permission to delete this product'
          });
        }
      }
    }

    // Soft delete the product
    await prisma.product.update({
      where: { id: productId },
      data: {
        deletedAt: new Date(),
        updatedBy: req.user.id,
        updatedAt: new Date()
      }
    });

    return res.status(200).json({
      status: 'success',
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Delete product error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while deleting product'
    });
  }
});

// Get all reviews for a specific product
router.get('/:productId/reviews', async (req, res) => {
  try {
    const { productId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    // Check if product exists
    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        isAvailable: true,
        deletedAt: null
      }
    });

    if (!product) {
      return res.status(404).json({
        status: 'fail',
        message: 'Product not found'
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [reviews, totalCount] = await Promise.all([
      prisma.review.findMany({
        where: {
          productId,
          reviewType: 'product',
          deletedAt: null
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
        },
        take: parseInt(limit),
        skip,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.review.count({
        where: {
          productId,
          reviewType: 'product',
          deletedAt: null
        }
      })
    ]);

    return res.status(200).json({
      status: 'success',
      data: {
        reviews,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(totalCount / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get product reviews error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching product reviews'
    });
  }
});

module.exports = router;
