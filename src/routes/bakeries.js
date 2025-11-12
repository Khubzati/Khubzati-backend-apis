const express = require('express');
const { PrismaClient } = require('../generated/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = express.Router();

// List all approved bakeries (with filtering/pagination)
router.get('/', async (req, res) => {
  try {
    const { city, search_term, page = 1, limit = 10 } = req.query;

    const whereClause = {
      status: 'approved',
      deletedAt: null
    };

    if (city) {
      whereClause.city = city;
    }

    if (search_term) {
      whereClause.OR = [
        { name: { contains: search_term, mode: 'insensitive' } },
        { description: { contains: search_term, mode: 'insensitive' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [bakeries, totalCount] = await Promise.all([
      prisma.bakery.findMany({
        where: whereClause,
        take: parseInt(limit),
        skip,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
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
      prisma.bakery.count({ where: whereClause })
    ]);

    return res.status(200).json({
      status: 'success',
      data: {
        bakeries,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(totalCount / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('List bakeries error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching bakeries'
    });
  }
});

// Get details of a specific bakery
router.get('/:bakeryId', async (req, res) => {
  try {
    const { bakeryId } = req.params;

    const bakery = await prisma.bakery.findFirst({
      where: {
        id: bakeryId,
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

    if (!bakery) {
      return res.status(404).json({
        status: 'fail',
        message: 'Bakery not found'
      });
    }

    return res.status(200).json({
      status: 'success',
      data: {
        bakery
      }
    });
  } catch (error) {
    console.error('Get bakery details error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching bakery details'
    });
  }
});

// Register a new bakery (Bakery Owner Role)
router.post('/', authenticateToken, authorizeRole(['bakery_owner', 'admin']), async (req, res) => {
  try {
    const {
      name,
      description,
      addressLine1,
      addressLine2,
      city,
      postalCode,
      country,
      phoneNumber,
      email,
      logoUrl,
      coverImageUrl,
      commercialRegistryUrl,
      operatingHours
    } = req.body;

    // Create new bakery
    const bakery = await prisma.bakery.create({
      data: {
        name,
        description,
        addressLine1,
        addressLine2,
        city,
        postalCode,
        country: country || 'Saudi Arabia',
        phoneNumber,
        email,
        logoUrl,
        coverImageUrl,
        commercialRegistryUrl,
        operatingHours,
        status: 'pending_approval',
        ownerId: req.user.id,
        createdBy: req.user.id
      }
    });

    return res.status(201).json({
      status: 'success',
      data: {
        bakery
      }
    });
  } catch (error) {
    console.error('Register bakery error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while registering bakery'
    });
  }
});

// Update bakery details (Bakery Owner Role, Admin)
router.put('/:bakeryId', authenticateToken, async (req, res) => {
  try {
    const { bakeryId } = req.params;
    const {
      name,
      description,
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

    // Find bakery
    const bakery = await prisma.bakery.findUnique({
      where: { id: bakeryId }
    });

    if (!bakery) {
      return res.status(404).json({
        status: 'fail',
        message: 'Bakery not found'
      });
    }

    // Check if user is authorized to update this bakery
    if (req.user.role !== 'admin' && bakery.ownerId !== req.user.id) {
      return res.status(403).json({
        status: 'fail',
        message: 'You do not have permission to update this bakery'
      });
    }

    // Update bakery
    const updatedBakery = await prisma.bakery.update({
      where: { id: bakeryId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
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
        bakery: updatedBakery
      }
    });
  } catch (error) {
    console.error('Update bakery error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while updating bakery'
    });
  }
});

// Get all products for a specific bakery
router.get('/:bakeryId/products', async (req, res) => {
  try {
    const { bakeryId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    // Check if bakery exists and is approved
    const bakery = await prisma.bakery.findFirst({
      where: {
        id: bakeryId,
        status: 'approved',
        deletedAt: null
      }
    });

    if (!bakery) {
      return res.status(404).json({
        status: 'fail',
        message: 'Bakery not found'
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [products, totalCount] = await Promise.all([
      prisma.product.findMany({
        where: {
          bakeryId,
          isAvailable: true,
          deletedAt: null
        },
        take: parseInt(limit),
        skip,
        orderBy: { name: 'asc' }
      }),
      prisma.product.count({
        where: {
          bakeryId,
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
    console.error('Get bakery products error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching bakery products'
    });
  }
});

// Get all reviews for a specific bakery
router.get('/:bakeryId/reviews', async (req, res) => {
  try {
    const { bakeryId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    // Check if bakery exists and is approved
    const bakery = await prisma.bakery.findFirst({
      where: {
        id: bakeryId,
        status: 'approved',
        deletedAt: null
      }
    });

    if (!bakery) {
      return res.status(404).json({
        status: 'fail',
        message: 'Bakery not found'
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [reviews, totalCount] = await Promise.all([
      prisma.review.findMany({
        where: {
          bakeryId,
          reviewType: 'bakery',
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
          bakeryId,
          reviewType: 'bakery',
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
    console.error('Get bakery reviews error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching bakery reviews'
    });
  }
});

module.exports = router;
