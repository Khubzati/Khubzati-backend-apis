const express = require('express');
const { PrismaClient } = require('../generated/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = express.Router();

// Middleware to ensure user owns a bakery
const ensureBakeryOwner = async (req, res, next) => {
    try {
        if (req.user.role === 'admin') {
            return next();
        }

        const bakery = await prisma.bakery.findFirst({
            where: {
                ownerId: req.user.id,
                deletedAt: null
            }
        });

        if (!bakery) {
            return res.status(403).json({
                status: 'fail',
                message: 'You must own a bakery to access this resource'
            });
        }

        req.bakery = bakery;
        next();
    } catch (error) {
        console.error('Ensure bakery owner error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while verifying bakery ownership'
        });
    }
};

// ========== DASHBOARD ENDPOINTS ==========

// Get dashboard summary
router.get('/dashboard', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const bakeryId = req.bakery?.id || req.query.bakeryId;

        if (!bakeryId && req.user.role !== 'admin') {
            return res.status(400).json({
                status: 'fail',
                message: 'Bakery ID is required'
            });
        }

        // Get bakery
        const bakery = await prisma.bakery.findUnique({
            where: { id: bakeryId || req.bakery.id }
        });

        if (!bakery) {
            return res.status(404).json({
                status: 'fail',
                message: 'Bakery not found'
            });
        }

        const bakeryIdToUse = bakery.id;

        // Get statistics
        const [
            totalOrders,
            totalRevenue,
            totalProducts,
            activeOrders,
            completedOrders,
            pendingOrders,
            cancelledOrders,
            totalCustomers
        ] = await Promise.all([
            prisma.order.count({
                where: {
                    bakeryId: bakeryIdToUse,
                    deletedAt: null
                }
            }),
            prisma.order.aggregate({
                where: {
                    bakeryId: bakeryIdToUse,
                    status: { in: ['completed', 'delivered'] },
                    paymentStatus: 'paid',
                    deletedAt: null
                },
                _sum: {
                    totalAmount: true
                }
            }),
            prisma.product.count({
                where: {
                    bakeryId: bakeryIdToUse,
                    deletedAt: null
                }
            }),
            prisma.order.count({
                where: {
                    bakeryId: bakeryIdToUse,
                    status: { in: ['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery'] },
                    deletedAt: null
                }
            }),
            prisma.order.count({
                where: {
                    bakeryId: bakeryIdToUse,
                    status: { in: ['completed', 'delivered'] },
                    deletedAt: null
                }
            }),
            prisma.order.count({
                where: {
                    bakeryId: bakeryIdToUse,
                    status: 'pending',
                    deletedAt: null
                }
            }),
            prisma.order.count({
                where: {
                    bakeryId: bakeryIdToUse,
                    status: 'cancelled',
                    deletedAt: null
                }
            }),
            prisma.order.findMany({
                where: {
                    bakeryId: bakeryIdToUse,
                    deletedAt: null
                },
                select: {
                    userId: true
                },
                distinct: ['userId']
            }).then(orders => orders.length)
        ]);

        return res.status(200).json({
            status: 'success',
            data: {
                summary: {
                    totalOrders,
                    totalRevenue: totalRevenue._sum.totalAmount || 0,
                    totalProducts,
                    activeOrders,
                    completedOrders,
                    pendingOrders,
                    cancelledOrders,
                    totalCustomers,
                    averageRating: bakery.averageRating,
                    reviewCount: bakery.reviewCount
                }
            }
        });
    } catch (error) {
        console.error('Get dashboard summary error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching dashboard summary'
        });
    }
});

// Get sales statistics
router.get('/dashboard/sales', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const { period = 'monthly', start_date, end_date } = req.query;
        const bakeryId = req.bakery?.id || req.query.bakeryId;

        if (!bakeryId && req.user.role !== 'admin') {
            return res.status(400).json({
                status: 'fail',
                message: 'Bakery ID is required'
            });
        }

        const bakeryIdToUse = bakeryId || req.bakery.id;

        // Calculate date range
        const now = new Date();
        let startDate, endDate;

        if (start_date && end_date) {
            startDate = new Date(start_date);
            endDate = new Date(end_date);
        } else {
            switch (period) {
                case 'daily':
                    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    endDate = new Date(now);
                    break;
                case 'weekly':
                    startDate = new Date(now);
                    startDate.setDate(startDate.getDate() - 7);
                    endDate = new Date(now);
                    break;
                case 'monthly':
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    endDate = new Date(now);
                    break;
                case 'yearly':
                    startDate = new Date(now.getFullYear(), 0, 1);
                    endDate = new Date(now);
                    break;
                default:
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    endDate = new Date(now);
            }
        }

        // Get sales data
        const orders = await prisma.order.findMany({
            where: {
                bakeryId: bakeryIdToUse,
                status: { in: ['completed', 'delivered'] },
                paymentStatus: 'paid',
                createdAt: {
                    gte: startDate,
                    lte: endDate
                },
                deletedAt: null
            },
            include: {
                orderItems: true
            }
        });

        const totalRevenue = orders.reduce((sum, order) => {
            return sum + parseFloat(order.totalAmount);
        }, 0);

        const totalOrders = orders.length;
        const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

        // Calculate daily/weekly/monthly breakdown
        const breakdown = {};
        orders.forEach(order => {
            const date = new Date(order.createdAt);
            let key;

            if (period === 'daily') {
                key = date.toISOString().split('T')[0];
            } else if (period === 'weekly') {
                const weekStart = new Date(date);
                weekStart.setDate(date.getDate() - date.getDay());
                key = weekStart.toISOString().split('T')[0];
            } else if (period === 'monthly') {
                key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            } else {
                key = date.getFullYear().toString();
            }

            if (!breakdown[key]) {
                breakdown[key] = { revenue: 0, orders: 0 };
            }
            breakdown[key].revenue += parseFloat(order.totalAmount);
            breakdown[key].orders += 1;
        });

        return res.status(200).json({
            status: 'success',
            data: {
                period,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                totalRevenue,
                totalOrders,
                averageOrderValue,
                breakdown
            }
        });
    } catch (error) {
        console.error('Get sales statistics error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching sales statistics'
        });
    }
});

// Get recent orders
router.get('/dashboard/recent-orders', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 5;
        const bakeryId = req.bakery?.id || req.query.bakeryId;

        if (!bakeryId && req.user.role !== 'admin') {
            return res.status(400).json({
                status: 'fail',
                message: 'Bakery ID is required'
            });
        }

        const bakeryIdToUse = bakeryId || req.bakery.id;

        const orders = await prisma.order.findMany({
            where: {
                bakeryId: bakeryIdToUse,
                deletedAt: null
            },
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        phoneNumber: true
                    }
                },
                orderItems: {
                    include: {
                        product: {
                            select: {
                                name: true,
                                imageUrl: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: limit
        });

        return res.status(200).json({
            status: 'success',
            data: orders
        });
    } catch (error) {
        console.error('Get recent orders error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching recent orders'
        });
    }
});

// Get top selling products
router.get('/dashboard/top-products', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 5;
        const period = req.query.period; // 'week', 'month', 'year'
        const bakeryId = req.bakery?.id || req.query.bakeryId;

        if (!bakeryId && req.user.role !== 'admin') {
            return res.status(400).json({
                status: 'fail',
                message: 'Bakery ID is required'
            });
        }

        const bakeryIdToUse = bakeryId || req.bakery.id;

        // Calculate date range if period is specified
        let startDate = null;
        if (period) {
            const now = new Date();
            switch (period) {
                case 'week':
                    startDate = new Date(now);
                    startDate.setDate(startDate.getDate() - 7);
                    break;
                case 'month':
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    break;
                case 'year':
                    startDate = new Date(now.getFullYear(), 0, 1);
                    break;
            }
        }

        const whereClause = {
            bakeryId: bakeryIdToUse,
            deletedAt: null
        };

        if (startDate) {
            whereClause.createdAt = { gte: startDate };
        }

        // Get all order items for this bakery
        const orderItems = await prisma.orderItem.findMany({
            where: {
                order: {
                    ...whereClause,
                    status: { in: ['completed', 'delivered'] }
                }
            },
            include: {
                product: {
                    select: {
                        id: true,
                        name: true,
                        imageUrl: true,
                        price: true
                    }
                }
            }
        });

        // Aggregate by product
        const productSales = {};
        orderItems.forEach(item => {
            const productId = item.productId;
            if (!productSales[productId]) {
                productSales[productId] = {
                    product: item.product,
                    totalQuantity: 0,
                    totalRevenue: 0
                };
            }
            productSales[productId].totalQuantity += item.quantity;
            productSales[productId].totalRevenue += parseFloat(item.subtotal);
        });

        // Sort by total revenue and take top N
        const topProducts = Object.values(productSales)
            .sort((a, b) => b.totalRevenue - a.totalRevenue)
            .slice(0, limit);

        return res.status(200).json({
            status: 'success',
            data: topProducts
        });
    } catch (error) {
        console.error('Get top products error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching top products'
        });
    }
});

// Get customer demographics
router.get('/dashboard/customer-demographics', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const bakeryId = req.bakery?.id || req.query.bakeryId;

        if (!bakeryId && req.user.role !== 'admin') {
            return res.status(400).json({
                status: 'fail',
                message: 'Bakery ID is required'
            });
        }

        const bakeryIdToUse = bakeryId || req.bakery.id;

        // Get all unique customers
        const orders = await prisma.order.findMany({
            where: {
                bakeryId: bakeryIdToUse,
                deletedAt: null
            },
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        phoneNumber: true,
                        createdAt: true
                    }
                },
                deliveryAddress: {
                    select: {
                        city: true
                    }
                }
            }
        });

        // Analyze demographics
        const customers = {};
        const locations = {};
        let totalCustomers = 0;

        orders.forEach(order => {
            if (!customers[order.userId]) {
                customers[order.userId] = true;
                totalCustomers++;

                const city = order.deliveryAddress?.city || 'Unknown';
                locations[city] = (locations[city] || 0) + 1;
            }
        });

        return res.status(200).json({
            status: 'success',
            data: {
                totalCustomers,
                locations,
                ordersCount: orders.length,
                repeatCustomers: Object.keys(customers).filter(id => {
                    const userOrders = orders.filter(o => o.userId === id);
                    return userOrders.length > 1;
                }).length
            }
        });
    } catch (error) {
        console.error('Get customer demographics error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching customer demographics'
        });
    }
});

// Get revenue forecast
router.get('/dashboard/revenue-forecast', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const { period = 'month' } = req.query; // 'week', 'month', 'quarter'
        const bakeryId = req.bakery?.id || req.query.bakeryId;

        if (!bakeryId && req.user.role !== 'admin') {
            return res.status(400).json({
                status: 'fail',
                message: 'Bakery ID is required'
            });
        }

        const bakeryIdToUse = bakeryId || req.bakery.id;

        // Get historical data for the same period in previous months
        const now = new Date();
        let historicalStart, historicalEnd, forecastStart, forecastEnd;

        if (period === 'week') {
            historicalStart = new Date(now);
            historicalStart.setDate(historicalStart.getDate() - 14);
            historicalEnd = new Date(now);
            historicalEnd.setDate(historicalEnd.getDate() - 7);
            forecastStart = new Date(now);
            forecastEnd = new Date(now);
            forecastEnd.setDate(forecastEnd.getDate() + 7);
        } else if (period === 'month') {
            historicalStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
            historicalEnd = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            forecastStart = new Date(now);
            forecastEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        } else {
            historicalStart = new Date(now.getFullYear(), now.getMonth() - 6, 1);
            historicalEnd = new Date(now.getFullYear(), now.getMonth() - 3, 1);
            forecastStart = new Date(now);
            forecastEnd = new Date(now.getFullYear(), now.getMonth() + 3, 1);
        }

        // Get historical revenue
        const historicalOrders = await prisma.order.findMany({
            where: {
                bakeryId: bakeryIdToUse,
                status: { in: ['completed', 'delivered'] },
                paymentStatus: 'paid',
                createdAt: {
                    gte: historicalStart,
                    lt: historicalEnd
                },
                deletedAt: null
            }
        });

        const historicalRevenue = historicalOrders.reduce((sum, order) => {
            return sum + parseFloat(order.totalAmount);
        }, 0);

        // Simple forecast: use historical average with growth trend
        const forecastRevenue = historicalRevenue * 1.1; // 10% growth assumption

        return res.status(200).json({
            status: 'success',
            data: {
                period,
                historicalRevenue,
                forecastRevenue,
                forecastStart: forecastStart.toISOString(),
                forecastEnd: forecastEnd.toISOString(),
                confidence: 0.75 // 75% confidence
            }
        });
    } catch (error) {
        console.error('Get revenue forecast error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching revenue forecast'
        });
    }
});

// Get inventory status
router.get('/dashboard/inventory', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const bakeryId = req.bakery?.id || req.query.bakeryId;

        if (!bakeryId && req.user.role !== 'admin') {
            return res.status(400).json({
                status: 'fail',
                message: 'Bakery ID is required'
            });
        }

        const bakeryIdToUse = bakeryId || req.bakery.id;

        // Get all products
        const products = await prisma.product.findMany({
            where: {
                bakeryId: bakeryIdToUse,
                deletedAt: null
            },
            select: {
                id: true,
                name: true,
                stockQuantity: true,
                isAvailable: true
            }
        });

        const lowStockThreshold = 10;
        const lowStockItems = products.filter(p => p.stockQuantity < lowStockThreshold);
        const outOfStockItems = products.filter(p => p.stockQuantity === 0);
        const totalProducts = products.length;
        const totalStockValue = products.reduce((sum, p) => {
            // Note: We don't have price in the select, so we'd need to fetch it
            // For now, using stockQuantity as a proxy
            return sum + p.stockQuantity;
        }, 0);

        return res.status(200).json({
            status: 'success',
            data: {
                totalProducts,
                totalStockValue,
                lowStockItems: lowStockItems.length,
                outOfStockItems: outOfStockItems.length,
                lowStockProducts: lowStockItems.map(p => ({
                    id: p.id,
                    name: p.name,
                    stockQuantity: p.stockQuantity
                })),
                outOfStockProducts: outOfStockItems.map(p => ({
                    id: p.id,
                    name: p.name,
                    stockQuantity: p.stockQuantity
                }))
            }
        });
    } catch (error) {
        console.error('Get inventory status error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching inventory status'
        });
    }
});

// ========== PRODUCT MANAGEMENT ENDPOINTS ==========

// Get all products for bakery
router.get('/products', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const { page = 1, limit = 20, category_id, search } = req.query;
        const bakeryId = req.bakery?.id || req.query.bakeryId;

        if (!bakeryId && req.user.role !== 'admin') {
            return res.status(400).json({
                status: 'fail',
                message: 'Bakery ID is required'
            });
        }

        const bakeryIdToUse = bakeryId || req.bakery.id;

        const whereClause = {
            bakeryId: bakeryIdToUse,
            deletedAt: null
        };

        if (category_id) {
            whereClause.categoryId = category_id;
        }

        if (search) {
            whereClause.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } }
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
                    }
                },
                take: parseInt(limit),
                skip,
                orderBy: { createdAt: 'desc' }
            }),
            prisma.product.count({ where: whereClause })
        ]);

        return res.status(200).json({
            status: 'success',
            data: products,
            meta: {
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
            message: 'An error occurred while fetching products'
        });
    }
});

// Get product details
router.get('/products/:productId', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const { productId } = req.params;
        const bakeryId = req.bakery?.id || req.query.bakeryId;

        if (!bakeryId && req.user.role !== 'admin') {
            return res.status(400).json({
                status: 'fail',
                message: 'Bakery ID is required'
            });
        }

        const bakeryIdToUse = bakeryId || req.bakery.id;

        const product = await prisma.product.findFirst({
            where: {
                id: productId,
                bakeryId: bakeryIdToUse,
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
                reviews: {
                    take: 5,
                    orderBy: { createdAt: 'desc' },
                    include: {
                        user: {
                            select: {
                                id: true,
                                fullName: true,
                                profilePictureUrl: true
                            }
                        }
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
            data: product
        });
    } catch (error) {
        console.error('Get product details error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching product details'
        });
    }
});

// Create product
router.post('/products', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const {
            name,
            description,
            price,
            imageUrl,
            categoryId,
            stockQuantity,
            preparationTimeMinutes,
            dietaryInfo
        } = req.body;

        const bakeryId = req.bakery?.id || req.body.bakeryId;

        if (!bakeryId && req.user.role !== 'admin') {
            return res.status(400).json({
                status: 'fail',
                message: 'Bakery ID is required'
            });
        }

        const bakeryIdToUse = bakeryId || req.bakery.id;

        // Verify bakery ownership if not admin
        if (req.user.role !== 'admin') {
            const bakery = await prisma.bakery.findFirst({
                where: {
                    id: bakeryIdToUse,
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

        const product = await prisma.product.create({
            data: {
                name,
                description,
                price: parseFloat(price),
                imageUrl,
                categoryId,
                itemType: 'bakery',
                bakeryId: bakeryIdToUse,
                stockQuantity: stockQuantity || 0,
                preparationTimeMinutes,
                dietaryInfo,
                isAvailable: true,
                createdBy: req.user.id
            }
        });

        return res.status(201).json({
            status: 'success',
            data: product
        });
    } catch (error) {
        console.error('Create product error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while creating product'
        });
    }
});

// Update product
router.put('/products/:productId', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
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

        const bakeryId = req.bakery?.id || req.query.bakeryId;

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

        // Check ownership
        if (req.user.role !== 'admin') {
            const bakeryIdToUse = bakeryId || req.bakery.id;
            if (product.bakeryId !== bakeryIdToUse) {
                return res.status(403).json({
                    status: 'fail',
                    message: 'You do not have permission to update this product'
                });
            }
        }

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
            data: updatedProduct
        });
    } catch (error) {
        console.error('Update product error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while updating product'
        });
    }
});

// Delete product
router.delete('/products/:productId', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const { productId } = req.params;
        const bakeryId = req.bakery?.id || req.query.bakeryId;

        const product = await prisma.product.findUnique({
            where: { id: productId }
        });

        if (!product) {
            return res.status(404).json({
                status: 'fail',
                message: 'Product not found'
            });
        }

        // Check ownership
        if (req.user.role !== 'admin') {
            const bakeryIdToUse = bakeryId || req.bakery.id;
            if (product.bakeryId !== bakeryIdToUse) {
                return res.status(403).json({
                    status: 'fail',
                    message: 'You do not have permission to delete this product'
                });
            }
        }

        // Soft delete
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

// Update product availability
router.patch('/products/:productId/availability', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const { productId } = req.params;
        const { is_available } = req.body;
        const bakeryId = req.bakery?.id || req.query.bakeryId;

        const product = await prisma.product.findUnique({
            where: { id: productId }
        });

        if (!product) {
            return res.status(404).json({
                status: 'fail',
                message: 'Product not found'
            });
        }

        // Check ownership
        if (req.user.role !== 'admin') {
            const bakeryIdToUse = bakeryId || req.bakery.id;
            if (product.bakeryId !== bakeryIdToUse) {
                return res.status(403).json({
                    status: 'fail',
                    message: 'You do not have permission to update this product'
                });
            }
        }

        const updatedProduct = await prisma.product.update({
            where: { id: productId },
            data: {
                isAvailable: is_available,
                updatedBy: req.user.id,
                updatedAt: new Date()
            }
        });

        return res.status(200).json({
            status: 'success',
            data: updatedProduct
        });
    } catch (error) {
        console.error('Update product availability error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while updating product availability'
        });
    }
});

// Upload product images (placeholder - actual implementation would use multer or similar)
router.post('/products/:productId/images', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const { productId } = req.params;
        const { imageUrl } = req.body; // In production, this would handle file uploads

        const product = await prisma.product.findUnique({
            where: { id: productId }
        });

        if (!product) {
            return res.status(404).json({
                status: 'fail',
                message: 'Product not found'
            });
        }

        // Update product with new image URL
        const updatedProduct = await prisma.product.update({
            where: { id: productId },
            data: {
                imageUrl: imageUrl || product.imageUrl,
                updatedBy: req.user.id,
                updatedAt: new Date()
            }
        });

        return res.status(200).json({
            status: 'success',
            data: updatedProduct,
            message: 'Image uploaded successfully'
        });
    } catch (error) {
        console.error('Upload product image error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while uploading product image'
        });
    }
});

// Delete product image
router.delete('/products/:productId/images/:imageId', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const { productId } = req.params;

        const product = await prisma.product.findUnique({
            where: { id: productId }
        });

        if (!product) {
            return res.status(404).json({
                status: 'fail',
                message: 'Product not found'
            });
        }

        // Clear image URL
        await prisma.product.update({
            where: { id: productId },
            data: {
                imageUrl: null,
                updatedBy: req.user.id,
                updatedAt: new Date()
            }
        });

        return res.status(200).json({
            status: 'success',
            message: 'Image deleted successfully'
        });
    } catch (error) {
        console.error('Delete product image error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while deleting product image'
        });
    }
});

// ========== CATEGORY MANAGEMENT ENDPOINTS ==========

// Get all categories
router.get('/categories', authenticateToken, authorizeRole(['bakery_owner', 'admin']), async (req, res) => {
    try {
        const categories = await prisma.category.findMany({
            where: {
                type: { in: ['bakery', 'common'] },
                deletedAt: null
            },
            orderBy: { name: 'asc' }
        });

        return res.status(200).json({
            status: 'success',
            data: categories
        });
    } catch (error) {
        console.error('Get categories error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching categories'
        });
    }
});

// Create category
router.post('/categories', authenticateToken, authorizeRole(['bakery_owner', 'admin']), async (req, res) => {
    try {
        const { name, description, imageUrl, parentCategoryId } = req.body;

        const category = await prisma.category.create({
            data: {
                name,
                description,
                imageUrl,
                type: 'bakery',
                parentCategoryId,
                createdBy: req.user.id
            }
        });

        return res.status(201).json({
            status: 'success',
            data: category
        });
    } catch (error) {
        console.error('Create category error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while creating category'
        });
    }
});

// Update category
router.put('/categories/:categoryId', authenticateToken, authorizeRole(['bakery_owner', 'admin']), async (req, res) => {
    try {
        const { categoryId } = req.params;
        const { name, description, imageUrl, parentCategoryId } = req.body;

        const category = await prisma.category.findUnique({
            where: { id: categoryId }
        });

        if (!category) {
            return res.status(404).json({
                status: 'fail',
                message: 'Category not found'
            });
        }

        const updatedCategory = await prisma.category.update({
            where: { id: categoryId },
            data: {
                ...(name !== undefined && { name }),
                ...(description !== undefined && { description }),
                ...(imageUrl !== undefined && { imageUrl }),
                ...(parentCategoryId !== undefined && { parentCategoryId }),
                updatedBy: req.user.id,
                updatedAt: new Date()
            }
        });

        return res.status(200).json({
            status: 'success',
            data: updatedCategory
        });
    } catch (error) {
        console.error('Update category error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while updating category'
        });
    }
});

// Delete category
router.delete('/categories/:categoryId', authenticateToken, authorizeRole(['bakery_owner', 'admin']), async (req, res) => {
    try {
        const { categoryId } = req.params;

        const category = await prisma.category.findUnique({
            where: { id: categoryId }
        });

        if (!category) {
            return res.status(404).json({
                status: 'fail',
                message: 'Category not found'
            });
        }

        // Check if category has products
        const productsCount = await prisma.product.count({
            where: {
                categoryId,
                deletedAt: null
            }
        });

        if (productsCount > 0) {
            return res.status(400).json({
                status: 'fail',
                message: 'Cannot delete category with associated products'
            });
        }

        // Soft delete
        await prisma.category.update({
            where: { id: categoryId },
            data: {
                deletedAt: new Date(),
                updatedBy: req.user.id,
                updatedAt: new Date()
            }
        });

        return res.status(200).json({
            status: 'success',
            message: 'Category deleted successfully'
        });
    } catch (error) {
        console.error('Delete category error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while deleting category'
        });
    }
});

// ========== ORDER MANAGEMENT ENDPOINTS ==========

// Get all orders for bakery
router.get('/orders', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const { page = 1, limit = 20, status, sort_by, sort_order, start_date, end_date } = req.query;
        const bakeryId = req.bakery?.id || req.query.bakeryId;

        if (!bakeryId && req.user.role !== 'admin') {
            return res.status(400).json({
                status: 'fail',
                message: 'Bakery ID is required'
            });
        }

        const bakeryIdToUse = bakeryId || req.bakery.id;

        const whereClause = {
            bakeryId: bakeryIdToUse,
            deletedAt: null
        };

        if (status) {
            whereClause.status = status;
        }

        if (start_date || end_date) {
            whereClause.createdAt = {};
            if (start_date) {
                whereClause.createdAt.gte = new Date(start_date);
            }
            if (end_date) {
                whereClause.createdAt.lte = new Date(end_date);
            }
        }

        const orderBy = {};
        if (sort_by) {
            orderBy[sort_by] = sort_order === 'desc' ? 'desc' : 'asc';
        } else {
            orderBy.createdAt = 'desc';
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [orders, totalCount] = await Promise.all([
            prisma.order.findMany({
                where: whereClause,
                include: {
                    user: {
                        select: {
                            id: true,
                            fullName: true,
                            phoneNumber: true
                        }
                    },
                    orderItems: {
                        include: {
                            product: {
                                select: {
                                    id: true,
                                    name: true,
                                    imageUrl: true
                                }
                            }
                        }
                    },
                    deliveryAddress: true
                },
                take: parseInt(limit),
                skip,
                orderBy
            }),
            prisma.order.count({ where: whereClause })
        ]);

        return res.status(200).json({
            status: 'success',
            data: orders,
            meta: {
                pagination: {
                    total: totalCount,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    pages: Math.ceil(totalCount / parseInt(limit))
                }
            }
        });
    } catch (error) {
        console.error('Get bakery orders error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching orders'
        });
    }
});

// Get order details
router.get('/orders/:orderId', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const { orderId } = req.params;
        const bakeryId = req.bakery?.id || req.query.bakeryId;

        if (!bakeryId && req.user.role !== 'admin') {
            return res.status(400).json({
                status: 'fail',
                message: 'Bakery ID is required'
            });
        }

        const bakeryIdToUse = bakeryId || req.bakery.id;

        const order = await prisma.order.findFirst({
            where: {
                id: orderId,
                bakeryId: bakeryIdToUse,
                deletedAt: null
            },
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        phoneNumber: true,
                        email: true
                    }
                },
                orderItems: {
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                imageUrl: true,
                                description: true,
                                price: true
                            }
                        }
                    }
                },
                deliveryAddress: true,
                bakery: {
                    select: {
                        id: true,
                        name: true,
                        phoneNumber: true,
                        addressLine1: true,
                        city: true
                    }
                }
            }
        });

        if (!order) {
            return res.status(404).json({
                status: 'fail',
                message: 'Order not found'
            });
        }

        return res.status(200).json({
            status: 'success',
            data: order
        });
    } catch (error) {
        console.error('Get order details error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching order details'
        });
    }
});

// Update order status
router.put('/orders/:orderId/status', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status, notes } = req.body;
        const bakeryId = req.bakery?.id || req.query.bakeryId;

        if (!status || !['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'completed', 'cancelled'].includes(status)) {
            return res.status(400).json({
                status: 'fail',
                message: 'Valid status is required'
            });
        }

        if (!bakeryId && req.user.role !== 'admin') {
            return res.status(400).json({
                status: 'fail',
                message: 'Bakery ID is required'
            });
        }

        const bakeryIdToUse = bakeryId || req.bakery.id;

        const order = await prisma.order.findFirst({
            where: {
                id: orderId,
                bakeryId: bakeryIdToUse,
                deletedAt: null
            }
        });

        if (!order) {
            return res.status(404).json({
                status: 'fail',
                message: 'Order not found'
            });
        }

        const updatedOrder = await prisma.order.update({
            where: { id: orderId },
            data: {
                status,
                updatedBy: req.user.id,
                updatedAt: new Date()
            }
        });

        // Create notification
        const statusMessages = {
            confirmed: 'Your order has been confirmed',
            preparing: 'Your order is being prepared',
            ready_for_pickup: 'Your order is ready for pickup',
            out_for_delivery: 'Your order is out for delivery',
            delivered: 'Your order has been delivered',
            completed: 'Your order has been completed',
            cancelled: 'Your order has been cancelled'
        };

        await prisma.notification.create({
            data: {
                userId: order.userId,
                title: 'Order Status Updated',
                message: `${statusMessages[status]}. Order #${order.orderNumber}`,
                type: 'order',
                relatedId: order.id,
                createdBy: 'system'
            }
        });

        return res.status(200).json({
            status: 'success',
            data: updatedOrder
        });
    } catch (error) {
        console.error('Update order status error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while updating order status'
        });
    }
});

// Assign delivery person (placeholder - would require driver/user model)
router.post('/orders/:orderId/assign-delivery', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const { orderId } = req.params;
        const { delivery_person_id } = req.body;

        const order = await prisma.order.findUnique({
            where: { id: orderId }
        });

        if (!order) {
            return res.status(404).json({
                status: 'fail',
                message: 'Order not found'
            });
        }

        // In a full implementation, you'd update the order with delivery person ID
        // For now, we'll just acknowledge the request
        return res.status(200).json({
            status: 'success',
            message: 'Delivery person assigned successfully',
            data: order
        });
    } catch (error) {
        console.error('Assign delivery person error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while assigning delivery person'
        });
    }
});

// Send customer notification
router.post('/orders/:orderId/notify-customer', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const { orderId } = req.params;
        const { message } = req.body;

        const order = await prisma.order.findUnique({
            where: { id: orderId }
        });

        if (!order) {
            return res.status(404).json({
                status: 'fail',
                message: 'Order not found'
            });
        }

        await prisma.notification.create({
            data: {
                userId: order.userId,
                title: 'Order Update',
                message: message || `Update regarding your order #${order.orderNumber}`,
                type: 'order',
                relatedId: order.id,
                createdBy: req.user.id
            }
        });

        return res.status(200).json({
            status: 'success',
            message: 'Notification sent successfully'
        });
    } catch (error) {
        console.error('Send customer notification error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while sending notification'
        });
    }
});

// Generate invoice
router.post('/orders/:orderId/generate-invoice', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const { orderId } = req.params;

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: {
                user: {
                    select: {
                        fullName: true,
                        email: true,
                        phoneNumber: true
                    }
                },
                orderItems: {
                    include: {
                        product: {
                            select: {
                                name: true,
                                price: true
                            }
                        }
                    }
                },
                bakery: {
                    select: {
                        name: true,
                        addressLine1: true,
                        city: true,
                        phoneNumber: true
                    }
                }
            }
        });

        if (!order) {
            return res.status(404).json({
                status: 'fail',
                message: 'Order not found'
            });
        }

        // Generate invoice data
        const invoice = {
            invoiceNumber: `INV-${order.orderNumber}`,
            orderNumber: order.orderNumber,
            date: order.createdAt,
            customer: {
                name: order.user.fullName,
                email: order.user.email,
                phone: order.user.phoneNumber
            },
            bakery: {
                name: order.bakery.name,
                address: order.bakery.addressLine1,
                city: order.bakery.city,
                phone: order.bakery.phoneNumber
            },
            items: order.orderItems.map(item => ({
                productName: item.product.name,
                quantity: item.quantity,
                unitPrice: item.price,
                subtotal: item.subtotal
            })),
            totalAmount: order.totalAmount,
            paymentMethod: order.paymentMethod,
            paymentStatus: order.paymentStatus
        };

        return res.status(200).json({
            status: 'success',
            data: invoice,
            message: 'Invoice generated successfully'
        });
    } catch (error) {
        console.error('Generate invoice error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while generating invoice'
        });
    }
});

// Search orders
router.get('/orders/search', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const { search, page = 1, limit = 20 } = req.query;
        const bakeryId = req.bakery?.id || req.query.bakeryId;

        if (!search) {
            return res.status(400).json({
                status: 'fail',
                message: 'Search term is required'
            });
        }

        if (!bakeryId && req.user.role !== 'admin') {
            return res.status(400).json({
                status: 'fail',
                message: 'Bakery ID is required'
            });
        }

        const bakeryIdToUse = bakeryId || req.bakery.id;

        const whereClause = {
            bakeryId: bakeryIdToUse,
            deletedAt: null,
            OR: [
                { orderNumber: { contains: search, mode: 'insensitive' } },
                { user: { fullName: { contains: search, mode: 'insensitive' } } },
                { user: { phoneNumber: { contains: search, mode: 'insensitive' } } }
            ]
        };

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [orders, totalCount] = await Promise.all([
            prisma.order.findMany({
                where: whereClause,
                include: {
                    user: {
                        select: {
                            id: true,
                            fullName: true,
                            phoneNumber: true
                        }
                    },
                    orderItems: {
                        include: {
                            product: {
                                select: {
                                    name: true
                                }
                            }
                        }
                    }
                },
                take: parseInt(limit),
                skip,
                orderBy: { createdAt: 'desc' }
            }),
            prisma.order.count({ where: whereClause })
        ]);

        return res.status(200).json({
            status: 'success',
            data: orders,
            meta: {
                pagination: {
                    total: totalCount,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    pages: Math.ceil(totalCount / parseInt(limit))
                }
            }
        });
    } catch (error) {
        console.error('Search orders error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while searching orders'
        });
    }
});

// Get order statistics
router.get('/orders/statistics', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const bakeryId = req.bakery?.id || req.query.bakeryId;

        if (!bakeryId && req.user.role !== 'admin') {
            return res.status(400).json({
                status: 'fail',
                message: 'Bakery ID is required'
            });
        }

        const bakeryIdToUse = bakeryId || req.bakery.id;

        const [
            pending,
            confirmed,
            preparing,
            readyForPickup,
            outForDelivery,
            delivered,
            completed,
            cancelled
        ] = await Promise.all([
            prisma.order.count({ where: { bakeryId: bakeryIdToUse, status: 'pending', deletedAt: null } }),
            prisma.order.count({ where: { bakeryId: bakeryIdToUse, status: 'confirmed', deletedAt: null } }),
            prisma.order.count({ where: { bakeryId: bakeryIdToUse, status: 'preparing', deletedAt: null } }),
            prisma.order.count({ where: { bakeryId: bakeryIdToUse, status: 'ready_for_pickup', deletedAt: null } }),
            prisma.order.count({ where: { bakeryId: bakeryIdToUse, status: 'out_for_delivery', deletedAt: null } }),
            prisma.order.count({ where: { bakeryId: bakeryIdToUse, status: 'delivered', deletedAt: null } }),
            prisma.order.count({ where: { bakeryId: bakeryIdToUse, status: 'completed', deletedAt: null } }),
            prisma.order.count({ where: { bakeryId: bakeryIdToUse, status: 'cancelled', deletedAt: null } })
        ]);

        return res.status(200).json({
            status: 'success',
            data: {
                pending,
                confirmed,
                preparing,
                readyForPickup,
                outForDelivery,
                delivered,
                completed,
                cancelled,
                total: pending + confirmed + preparing + readyForPickup + outForDelivery + delivered + completed + cancelled
            }
        });
    } catch (error) {
        console.error('Get order statistics error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching order statistics'
        });
    }
});

// Generate order report
router.post('/orders/reports', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const { start_date, end_date, report_type = 'orders' } = req.body;
        const bakeryId = req.bakery?.id || req.query.bakeryId;

        if (!start_date || !end_date) {
            return res.status(400).json({
                status: 'fail',
                message: 'Start date and end date are required'
            });
        }

        if (!bakeryId && req.user.role !== 'admin') {
            return res.status(400).json({
                status: 'fail',
                message: 'Bakery ID is required'
            });
        }

        const bakeryIdToUse = bakeryId || req.bakery.id;

        const startDate = new Date(start_date);
        const endDate = new Date(end_date);

        const orders = await prisma.order.findMany({
            where: {
                bakeryId: bakeryIdToUse,
                createdAt: {
                    gte: startDate,
                    lte: endDate
                },
                deletedAt: null
            },
            include: {
                orderItems: {
                    include: {
                        product: true
                    }
                },
                user: {
                    select: {
                        fullName: true,
                        phoneNumber: true
                    }
                }
            }
        });

        let reportData = {};

        if (report_type === 'sales') {
            const totalRevenue = orders
                .filter(o => o.status === 'completed' || o.status === 'delivered')
                .reduce((sum, o) => sum + parseFloat(o.totalAmount), 0);

            reportData = {
                totalRevenue,
                totalOrders: orders.length,
                averageOrderValue: orders.length > 0 ? totalRevenue / orders.length : 0
            };
        } else if (report_type === 'orders') {
            reportData = {
                totalOrders: orders.length,
                ordersByStatus: {
                    pending: orders.filter(o => o.status === 'pending').length,
                    confirmed: orders.filter(o => o.status === 'confirmed').length,
                    preparing: orders.filter(o => o.status === 'preparing').length,
                    delivered: orders.filter(o => o.status === 'delivered').length,
                    completed: orders.filter(o => o.status === 'completed').length,
                    cancelled: orders.filter(o => o.status === 'cancelled').length
                }
            };
        } else {
            reportData = {
                orders: orders.map(o => ({
                    orderNumber: o.orderNumber,
                    customerName: o.user.fullName,
                    totalAmount: o.totalAmount,
                    status: o.status,
                    createdAt: o.createdAt
                }))
            };
        }

        return res.status(200).json({
            status: 'success',
            data: {
                reportType: report_type,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                ...reportData
            },
            message: 'Report generated successfully'
        });
    } catch (error) {
        console.error('Generate order report error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while generating report'
        });
    }
});

// ========== BAKERY PROFILE ENDPOINTS ==========

// Get bakery profile (for the logged-in bakery owner)
router.get('/profile', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
    try {
        const bakery = await prisma.bakery.findUnique({
            where: { id: req.bakery.id },
            include: {
                owner: {
                    select: {
                        id: true,
                        username: true,
                        email: true,
                        fullName: true,
                        phoneNumber: true,
                        profilePictureUrl: true
                    }
                },
                products: {
                    where: { deletedAt: null },
                    select: {
                        id: true,
                        name: true,
                        price: true,
                        isAvailable: true
                    },
                    take: 5
                },
                _count: {
                    select: {
                        products: true,
                        orders: true,
                        reviews: true
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
            data: bakery
        });
    } catch (error) {
        console.error('Get bakery profile error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching bakery profile'
        });
    }
});

// Update bakery profile
router.put('/profile', authenticateToken, authorizeRole(['bakery_owner', 'admin']), ensureBakeryOwner, async (req, res) => {
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
            operatingHours
        } = req.body;

        const updatedBakery = await prisma.bakery.update({
            where: { id: req.bakery.id },
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
            },
            include: {
                owner: {
                    select: {
                        id: true,
                        username: true,
                        email: true,
                        fullName: true,
                        phoneNumber: true
                    }
                }
            }
        });

        return res.status(200).json({
            status: 'success',
            data: updatedBakery
        });
    } catch (error) {
        console.error('Update bakery profile error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while updating bakery profile'
        });
    }
});

module.exports = router;

