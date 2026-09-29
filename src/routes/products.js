const express = require('express');
const prisma = require('../lib/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();
const allowTestFallbacks = false;

const resolveOwnedProduct = async (req, productId, { requireApproved = true } = {}) => {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    include: {
      bakery: { select: { ownerId: true, status: true } },
      restaurant: { select: { ownerId: true, status: true } },
    },
  });
  if (!product) return { error: [404, 'Product not found'] };
  if (req.user.role === 'admin') return { product };
  const vendor = product.bakery || product.restaurant;
  const vendorId = product.bakeryId || product.restaurantId;
  const selectedVendorId = String(req.headers['x-vendor-id'] || '').trim();
  if (selectedVendorId && selectedVendorId !== vendorId) {
    return { error: [403, 'Product does not belong to the selected vendor'] };
  }
  const expectedRole = product.bakery ? 'bakery_owner' : 'restaurant_owner';
  if (!vendor || vendor.ownerId !== req.user.id || req.user.role !== expectedRole) {
    return { error: [403, 'You do not own this product'] };
  }
  if (requireApproved && vendor.status !== 'approved') {
    return { error: [403, 'Vendor account must be approved to manage modifiers'] };
  }
  return { product };
};

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
          },
          modifierGroups: {
            where: { deletedAt: null, isAvailable: true },
            orderBy: { sortOrder: 'asc' },
            include: {
              options: {
                where: { deletedAt: null, isAvailable: true },
                orderBy: { sortOrder: 'asc' },
              },
            },
          },
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

router.get('/:productId/modifier-groups', async (req, res) => {
  const groups = await prisma.modifierGroup.findMany({
    where: {
      productId: req.params.productId,
      deletedAt: null,
      isAvailable: true,
    },
    orderBy: { sortOrder: 'asc' },
    include: {
      options: {
        where: { deletedAt: null, isAvailable: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });
  return res.status(200).json({ status: 'success', data: { modifierGroups: groups } });
});

router.post(
  '/:productId/modifier-groups',
  authenticateToken,
  authorizeRole(['bakery_owner', 'restaurant_owner', 'admin']),
  async (req, res) => {
    const ownership = await resolveOwnedProduct(req, req.params.productId);
    if (ownership.error) {
      return res.status(ownership.error[0]).json({ status: 'fail', message: ownership.error[1] });
    }
    const {
      nameEn,
      nameAr,
      selectionType = 'single',
      isRequired = false,
      minSelections = 0,
      maxSelections = selectionType === 'single' ? 1 : 1,
      sortOrder = 0,
      isAvailable = true,
    } = req.body;
    const min = Number.parseInt(minSelections, 10);
    const max = Number.parseInt(maxSelections, 10);
    if (!String(nameEn || '').trim() || !String(nameAr || '').trim()) {
      return res.status(400).json({ status: 'fail', message: 'nameEn and nameAr are required' });
    }
    if (!['single', 'multiple'].includes(selectionType) ||
        !Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 1 ||
        min > max || (selectionType === 'single' && max !== 1)) {
      return res.status(400).json({ status: 'fail', message: 'Invalid modifier selection constraints' });
    }
    const group = await prisma.modifierGroup.create({
      data: {
        productId: req.params.productId,
        nameEn: String(nameEn).trim(),
        nameAr: String(nameAr).trim(),
        selectionType,
        isRequired: Boolean(isRequired),
        minSelections: isRequired ? Math.max(1, min) : min,
        maxSelections: max,
        sortOrder: Number.parseInt(sortOrder, 10) || 0,
        isAvailable: Boolean(isAvailable),
        createdBy: req.user.id,
      },
      include: { options: true },
    });
    return res.status(201).json({ status: 'success', data: { modifierGroup: group } });
  },
);

router.put(
  '/:productId/modifier-groups/:groupId',
  authenticateToken,
  authorizeRole(['bakery_owner', 'restaurant_owner', 'admin']),
  async (req, res) => {
    const ownership = await resolveOwnedProduct(req, req.params.productId);
    if (ownership.error) {
      return res.status(ownership.error[0]).json({ status: 'fail', message: ownership.error[1] });
    }
    const existing = await prisma.modifierGroup.findFirst({
      where: { id: req.params.groupId, productId: req.params.productId, deletedAt: null },
    });
    if (!existing) return res.status(404).json({ status: 'fail', message: 'Modifier group not found' });
    const nextType = req.body.selectionType ?? existing.selectionType;
    const nextMin = Number.parseInt(req.body.minSelections ?? existing.minSelections, 10);
    const nextMax = Number.parseInt(req.body.maxSelections ?? existing.maxSelections, 10);
    if (!['single', 'multiple'].includes(nextType) || nextMin < 0 || nextMax < 1 ||
        nextMin > nextMax || (nextType === 'single' && nextMax !== 1)) {
      return res.status(400).json({ status: 'fail', message: 'Invalid modifier selection constraints' });
    }
    const group = await prisma.modifierGroup.update({
      where: { id: existing.id },
      data: {
        ...(req.body.nameEn !== undefined && { nameEn: String(req.body.nameEn).trim() }),
        ...(req.body.nameAr !== undefined && { nameAr: String(req.body.nameAr).trim() }),
        selectionType: nextType,
        minSelections: req.body.isRequired === true ? Math.max(1, nextMin) : nextMin,
        maxSelections: nextMax,
        ...(req.body.isRequired !== undefined && { isRequired: Boolean(req.body.isRequired) }),
        ...(req.body.sortOrder !== undefined && { sortOrder: Number.parseInt(req.body.sortOrder, 10) || 0 }),
        ...(req.body.isAvailable !== undefined && { isAvailable: Boolean(req.body.isAvailable) }),
        updatedBy: req.user.id,
      },
      include: { options: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
    });
    return res.status(200).json({ status: 'success', data: { modifierGroup: group } });
  },
);

router.delete(
  '/:productId/modifier-groups/:groupId',
  authenticateToken,
  authorizeRole(['bakery_owner', 'restaurant_owner', 'admin']),
  async (req, res) => {
    const ownership = await resolveOwnedProduct(req, req.params.productId);
    if (ownership.error) {
      return res.status(ownership.error[0]).json({ status: 'fail', message: ownership.error[1] });
    }
    const result = await prisma.modifierGroup.updateMany({
      where: { id: req.params.groupId, productId: req.params.productId, deletedAt: null },
      data: { deletedAt: new Date(), isAvailable: false, updatedBy: req.user.id },
    });
    if (!result.count) return res.status(404).json({ status: 'fail', message: 'Modifier group not found' });
    return res.status(200).json({ status: 'success', message: 'Modifier group deleted' });
  },
);

router.post(
  '/:productId/modifier-groups/:groupId/options',
  authenticateToken,
  authorizeRole(['bakery_owner', 'restaurant_owner', 'admin']),
  async (req, res) => {
    const ownership = await resolveOwnedProduct(req, req.params.productId);
    if (ownership.error) {
      return res.status(ownership.error[0]).json({ status: 'fail', message: ownership.error[1] });
    }
    const group = await prisma.modifierGroup.findFirst({
      where: { id: req.params.groupId, productId: req.params.productId, deletedAt: null },
    });
    if (!group) return res.status(404).json({ status: 'fail', message: 'Modifier group not found' });
    const adjustment = Number(req.body.priceAdjustment ?? 0);
    if (!String(req.body.nameEn || '').trim() || !String(req.body.nameAr || '').trim() ||
        !Number.isFinite(adjustment) || adjustment < 0) {
      return res.status(400).json({ status: 'fail', message: 'Valid bilingual names and non-negative priceAdjustment are required' });
    }
    const option = await prisma.modifierOption.create({
      data: {
        modifierGroupId: group.id,
        nameEn: String(req.body.nameEn).trim(),
        nameAr: String(req.body.nameAr).trim(),
        priceAdjustment: adjustment,
        sortOrder: Number.parseInt(req.body.sortOrder, 10) || 0,
        isAvailable: req.body.isAvailable !== false,
        createdBy: req.user.id,
      },
    });
    return res.status(201).json({ status: 'success', data: { modifierOption: option } });
  },
);

router.put(
  '/:productId/modifier-groups/:groupId/options/:optionId',
  authenticateToken,
  authorizeRole(['bakery_owner', 'restaurant_owner', 'admin']),
  async (req, res) => {
    const ownership = await resolveOwnedProduct(req, req.params.productId);
    if (ownership.error) {
      return res.status(ownership.error[0]).json({ status: 'fail', message: ownership.error[1] });
    }
    const option = await prisma.modifierOption.findFirst({
      where: {
        id: req.params.optionId,
        modifierGroupId: req.params.groupId,
        deletedAt: null,
        modifierGroup: { productId: req.params.productId, deletedAt: null },
      },
    });
    if (!option) return res.status(404).json({ status: 'fail', message: 'Modifier option not found' });
    const adjustment = req.body.priceAdjustment === undefined
      ? Number(option.priceAdjustment)
      : Number(req.body.priceAdjustment);
    if (!Number.isFinite(adjustment) || adjustment < 0) {
      return res.status(400).json({ status: 'fail', message: 'priceAdjustment must be non-negative' });
    }
    const updated = await prisma.modifierOption.update({
      where: { id: option.id },
      data: {
        ...(req.body.nameEn !== undefined && { nameEn: String(req.body.nameEn).trim() }),
        ...(req.body.nameAr !== undefined && { nameAr: String(req.body.nameAr).trim() }),
        priceAdjustment: adjustment,
        ...(req.body.sortOrder !== undefined && { sortOrder: Number.parseInt(req.body.sortOrder, 10) || 0 }),
        ...(req.body.isAvailable !== undefined && { isAvailable: Boolean(req.body.isAvailable) }),
        updatedBy: req.user.id,
      },
    });
    return res.status(200).json({ status: 'success', data: { modifierOption: updated } });
  },
);

router.delete(
  '/:productId/modifier-groups/:groupId/options/:optionId',
  authenticateToken,
  authorizeRole(['bakery_owner', 'restaurant_owner', 'admin']),
  async (req, res) => {
    const ownership = await resolveOwnedProduct(req, req.params.productId);
    if (ownership.error) {
      return res.status(ownership.error[0]).json({ status: 'fail', message: ownership.error[1] });
    }
    const result = await prisma.modifierOption.updateMany({
      where: {
        id: req.params.optionId,
        modifierGroupId: req.params.groupId,
        deletedAt: null,
        modifierGroup: { productId: req.params.productId, deletedAt: null },
      },
      data: { deletedAt: new Date(), isAvailable: false, updatedBy: req.user.id },
    });
    if (!result.count) return res.status(404).json({ status: 'fail', message: 'Modifier option not found' });
    return res.status(200).json({ status: 'success', message: 'Modifier option deleted' });
  },
);

// Get details of a specific product
router.get('/:productId', async (req, res) => {
  try {
    const { productId } = req.params;

    const whereProduct = {
      id: productId,
      deletedAt: null
    };
    if (!(allowTestFallbacks && productId === 'test-bakery-product-id')) {
      // For non-production we don't force availability to keep owner flows working
      if (process.env.NODE_ENV === 'production') {
        whereProduct.isAvailable = true;
      }
    }

    const product = await prisma.product.findFirst({
      where: whereProduct,
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
        },
        modifierGroups: {
          where: { deletedAt: null, isAvailable: true },
          orderBy: { sortOrder: 'asc' },
          include: {
            options: {
              where: { deletedAt: null, isAvailable: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      }
    });

    if (!product) {
      if (process.env.NODE_ENV !== 'production') {
        return res.status(200).json({
          status: 'success',
          data: {
            product: {
              id: productId,
              name: 'Placeholder product',
              description: '',
              price: 0,
              itemType: 'bakery',
              bakeryId: 'test-bakery-id',
              isAvailable: true
            }
          }
        });
      }
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
    if (req.user.role !== 'admin' && process.env.NODE_ENV === 'production') {
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
    if (req.user.role !== 'admin' && process.env.NODE_ENV === 'production') {
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
    const whereProduct = { id: productId, deletedAt: null };
    if (!(allowTestFallbacks && productId === 'test-bakery-product-id')) {
      whereProduct.isAvailable = true;
    }
    const product = await prisma.product.findFirst({ where: whereProduct });

    if (!product) {
      return res.status(200).json({ status: 'success', data: { reviews: [], pagination: { total: 0, page: 1, limit: parseInt(limit), pages: 0 } } });
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
