const express = require('express');
const { PrismaClient } = require('../generated/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = express.Router();

// List all approved restaurants (with filtering/pagination)
router.get('/', async (req, res) => {
  try {
    const { city, cuisine_type, search_term, page = 1, limit = 10 } = req.query;
    
    const whereClause = {
      status: 'approved',
      deletedAt: null
    };
    
    if (city) {
      whereClause.city = city;
    }
    
    if (cuisine_type) {
      whereClause.cuisineType = cuisine_type;
    }
    
    if (search_term) {
      whereClause.OR = [
        { name: { contains: search_term, mode: 'insensitive' } },
        { description: { contains: search_term, mode: 'insensitive' } }
      ];
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [restaurants, totalCount] = await Promise.all([
      prisma.restaurant.findMany({
        where: whereClause,
        take: parseInt(limit),
        skip,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          cuisineType: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          postalCode: true,
          country: true,
          phoneNumber: true,
          email: true,
          logoUrl: true,
          coverImageUrl: true,
          operatingHours: true,
          status: true,
          averageRating: true,
          reviewCount: true,
          createdAt: true,
          updatedAt: true
        }
      }),
      prisma.restaurant.count({ where: whereClause })
    ]);
    
    return res.status(200).json({
      status: 'success',
      data: {
        restaurants,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(totalCount / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('List restaurants error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching restaurants'
    });
  }
});

// Get details of a specific restaurant
router.get('/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    
    const restaurant = await prisma.restaurant.findFirst({
      where: {
        id: restaurantId,
        status: 'approved',
        deletedAt: null
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            fullName: true
          }
        }
      }
    });
    
    if (!restaurant) {
      return res.status(404).json({
        status: 'fail',
        message: 'Restaurant not found'
      });
    }
    
    return res.status(200).json({
      status: 'success',
      data: {
        restaurant
      }
    });
  } catch (error) {
    console.error('Get restaurant details error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching restaurant details'
    });
  }
});

// Register a new restaurant (Restaurant Owner Role)
router.post('/', authenticateToken, authorizeRole(['restaurant_owner', 'admin']), async (req, res) => {
  try {
    const {
      name,
      description,
      cuisineType,
      addressLine1,
      addressLine2,
      city,
      postalCode,
      country,
      phoneNumber,
      email,
      logoUrl,
      coverImageUrl,
      operatingHours
    } = req.body;
    
    // Create new restaurant
    const restaurant = await prisma.restaurant.create({
      data: {
        name,
        description,
        cuisineType,
        addressLine1,
        addressLine2,
        city,
        postalCode,
        country: country || 'Saudi Arabia',
        phoneNumber,
        email,
        logoUrl,
        coverImageUrl,
        operatingHours,
        status: 'pending_approval',
        ownerId: req.user.id,
        createdBy: req.user.id
      }
    });
    
    return res.status(201).json({
      status: 'success',
      data: {
        restaurant
      }
    });
  } catch (error) {
    console.error('Register restaurant error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while registering restaurant'
    });
  }
});

// Update restaurant details (Restaurant Owner Role, Admin)
router.put('/:restaurantId', authenticateToken, async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const {
      name,
      description,
      cuisineType,
      addressLine1,
      addressLine2,
      city,
      postalCode,
      country,
      phoneNumber,
      email,
      logoUrl,
      coverImageUrl,
      operatingHours
    } = req.body;
    
    // Find restaurant
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId }
    });
    
    if (!restaurant) {
      return res.status(404).json({
        status: 'fail',
        message: 'Restaurant not found'
      });
    }
    
    // Check if user is authorized to update this restaurant
    if (req.user.role !== 'admin' && restaurant.ownerId !== req.user.id) {
      return res.status(403).json({
        status: 'fail',
        message: 'You do not have permission to update this restaurant'
      });
    }
    
    // Update restaurant
    const updatedRestaurant = await prisma.restaurant.update({
      where: { id: restaurantId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(cuisineType !== undefined && { cuisineType }),
        ...(addressLine1 !== undefined && { addressLine1 }),
        ...(addressLine2 !== undefined && { addressLine2 }),
        ...(city !== undefined && { city }),
        ...(postalCode !== undefined && { postalCode }),
        ...(country !== undefined && { country }),
        ...(phoneNumber !== undefined && { phoneNumber }),
        ...(email !== undefined && { email }),
        ...(logoUrl !== undefined && { logoUrl }),
        ...(coverImageUrl !== undefined && { coverImageUrl }),
        ...(operatingHours !== undefined && { operatingHours }),
        updatedBy: req.user.id,
        updatedAt: new Date()
      }
    });
    
    return res.status(200).json({
      status: 'success',
      data: {
        restaurant: updatedRestaurant
      }
    });
  } catch (error) {
    console.error('Update restaurant error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while updating restaurant'
    });
  }
});

// Get all products for a specific restaurant
router.get('/:restaurantId/products', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    
    // Check if restaurant exists and is approved
    const restaurant = await prisma.restaurant.findFirst({
      where: {
        id: restaurantId,
        status: 'approved',
        deletedAt: null
      }
    });
    
    if (!restaurant) {
      return res.status(404).json({
        status: 'fail',
        message: 'Restaurant not found'
      });
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [products, totalCount] = await Promise.all([
      prisma.product.findMany({
        where: {
          restaurantId,
          isAvailable: true,
          deletedAt: null
        },
        take: parseInt(limit),
        skip,
        orderBy: { name: 'asc' }
      }),
      prisma.product.count({
        where: {
          restaurantId,
          isAvailable: true,
          deletedAt: null
        }
      })
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
    console.error('Get restaurant products error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching restaurant products'
    });
  }
});

// Get all reviews for a specific restaurant
router.get('/:restaurantId/reviews', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    
    // Check if restaurant exists and is approved
    const restaurant = await prisma.restaurant.findFirst({
      where: {
        id: restaurantId,
        status: 'approved',
        deletedAt: null
      }
    });
    
    if (!restaurant) {
      return res.status(404).json({
        status: 'fail',
        message: 'Restaurant not found'
      });
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [reviews, totalCount] = await Promise.all([
      prisma.review.findMany({
        where: {
          restaurantId,
          reviewType: 'restaurant',
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
          restaurantId,
          reviewType: 'restaurant',
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
    console.error('Get restaurant reviews error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching restaurant reviews'
    });
  }
});

module.exports = router;
