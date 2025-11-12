const express = require('express');
const { PrismaClient } = require('../generated/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();
const router = express.Router();

// Admin Auth Routes (public)
router.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                status: 'fail',
                message: 'Email and password are required'
            });
        }

        const user = await prisma.user.findFirst({
            where: {
                email: email,
                role: 'admin',
                deletedAt: null
            }
        });

        if (!user) {
            return res.status(401).json({
                status: 'fail',
                message: 'Invalid credentials'
            });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                status: 'fail',
                message: 'Invalid credentials'
            });
        }

        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        const userData = { ...user };
        delete userData.password;

        return res.status(200).json({
            status: 'success',
            message: 'Login successful',
            data: {
                user: {
                    id: userData.id,
                    email: userData.email,
                    role: userData.role,
                    fullName: userData.fullName,
                },
                token
            }
        });
    } catch (error) {
        console.error('Admin login error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred during login'
        });
    }
});

// All other admin routes require authentication and admin role
router.use(authenticateToken);
router.use(authorizeRole(['admin']));

router.get('/auth/me', async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: {
                id: true,
                email: true,
                role: true,
                fullName: true,
            }
        });

        return res.status(200).json({
            status: 'success',
            data: user
        });
    } catch (error) {
        console.error('Get current admin error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred'
        });
    }
});

// Dashboard
router.get('/dashboard', async (req, res) => {
    try {
        const [totalUsers, bakeryCount, restaurantCount, totalOrders, statsResult, bakeries, restaurants] = await Promise.all([
            prisma.user.count({ where: { deletedAt: null } }),
            prisma.bakery.count({ where: { deletedAt: null, status: 'approved' } }),
            prisma.restaurant.count({ where: { deletedAt: null, status: 'approved' } }),
            prisma.order.count({ where: { deletedAt: null } }),
            prisma.order.aggregate({
                where: { deletedAt: null },
                _sum: { totalAmount: true }
            }),
            prisma.bakery.count({ where: { deletedAt: null, status: 'pending_approval' } }),
            prisma.restaurant.count({ where: { deletedAt: null, status: 'pending_approval' } })
        ]);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const [todayOrders, todayRevenue] = await Promise.all([
            prisma.order.count({
                where: {
                    createdAt: { gte: today, lt: tomorrow },
                    deletedAt: null
                }
            }),
            prisma.order.aggregate({
                where: {
                    createdAt: { gte: today, lt: tomorrow },
                    deletedAt: null
                },
                _sum: { totalAmount: true }
            })
        ]);

        const dashboardData = {
            stats: {
                totalUsers,
                totalVendors: bakeryCount + restaurantCount,
                totalOrders,
                totalRevenue: Number(statsResult._sum.totalAmount || 0),
                pendingApprovals: bakeries + restaurants,
                activeIssues: 0, // TODO: Implement issues tracking
                todayOrders,
                todayRevenue: Number(todayRevenue._sum.totalAmount || 0),
            },
            userGrowth: [],
            orderTrends: [],
            topVendors: [],
            recentActivity: []
        };

        return res.status(200).json({
            status: 'success',
            data: dashboardData
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching dashboard data'
        });
    }
});

// Users Management
router.get('/users', async (req, res) => {
    try {
        const { role, status, search, page = 1, limit = 20 } = req.query;

        const whereClause = {
            deletedAt: null
        };

        if (role) {
            whereClause.role = role;
        }

        if (search) {
            whereClause.OR = [
                { email: { contains: search, mode: 'insensitive' } },
                { username: { contains: search, mode: 'insensitive' } },
                { fullName: { contains: search, mode: 'insensitive' } },
                { phoneNumber: { contains: search, mode: 'insensitive' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where: whereClause,
                skip,
                take: parseInt(limit),
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    username: true,
                    email: true,
                    fullName: true,
                    phoneNumber: true,
                    role: true,
                    isVerified: true,
                    profilePictureUrl: true,
                    createdAt: true,
                    updatedAt: true,
                    deletedAt: true,
                }
            }),
            prisma.user.count({ where: whereClause })
        ]);

        return res.status(200).json({
            status: 'success',
            data: {
                users,
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get users error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching users'
        });
    }
});

router.get('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                username: true,
                email: true,
                fullName: true,
                phoneNumber: true,
                role: true,
                isVerified: true,
                profilePictureUrl: true,
                createdAt: true,
                updatedAt: true,
                deletedAt: true,
            }
        });

        if (!user) {
            return res.status(404).json({
                status: 'fail',
                message: 'User not found'
            });
        }

        return res.status(200).json({
            status: 'success',
            data: user
        });
    } catch (error) {
        console.error('Get user error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching user'
        });
    }
});

router.put('/users/:id/suspend', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        await prisma.user.update({
            where: { id },
            data: {
                deletedAt: new Date()
            }
        });

        return res.status(200).json({
            status: 'success',
            message: 'User suspended successfully'
        });
    } catch (error) {
        console.error('Suspend user error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while suspending user'
        });
    }
});

router.put('/users/:id/activate', async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.user.update({
            where: { id },
            data: {
                deletedAt: null
            }
        });

        return res.status(200).json({
            status: 'success',
            message: 'User activated successfully'
        });
    } catch (error) {
        console.error('Activate user error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while activating user'
        });
    }
});

router.put('/users/:id/verify', async (req, res) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id },
            include: {
                bakeries: {
                    where: {
                        status: 'pending_approval',
                        deletedAt: null
                    }
                },
                restaurants: {
                    where: {
                        status: 'pending_approval',
                        deletedAt: null
                    }
                }
            }
        });

        if (!user) {
            return res.status(404).json({
                status: 'fail',
                message: 'User not found'
            });
        }

        // For bakery owners, also approve their pending bakeries when verifying
        if (user.role === 'bakery_owner' && user.bakeries.length > 0) {
            await prisma.bakery.updateMany({
                where: {
                    ownerId: id,
                    status: 'pending_approval',
                    deletedAt: null
                },
                data: {
                    status: 'approved',
                    updatedBy: req.user.id
                }
            });
        }

        // For restaurant owners, also approve their pending restaurants when verifying
        if (user.role === 'restaurant_owner' && user.restaurants.length > 0) {
            await prisma.restaurant.updateMany({
                where: {
                    ownerId: id,
                    status: 'pending_approval',
                    deletedAt: null
                },
                data: {
                    status: 'approved',
                    updatedBy: req.user.id
                }
            });
        }

        await prisma.user.update({
            where: { id },
            data: {
                isVerified: true,
                updatedBy: req.user.id
            }
        });

        return res.status(200).json({
            status: 'success',
            message: 'User verified successfully'
        });
    } catch (error) {
        console.error('Verify user error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while verifying user'
        });
    }
});

router.put('/users/:id/unverify', async (req, res) => {
    try {
        const { id } = req.params;

        const user = await prisma.user.findUnique({
            where: { id },
            include: {
                bakeries: {
                    where: {
                        status: 'approved',
                        deletedAt: null
                    }
                },
                restaurants: {
                    where: {
                        status: 'approved',
                        deletedAt: null
                    }
                }
            }
        });

        if (!user) {
            return res.status(404).json({
                status: 'fail',
                message: 'User not found'
            });
        }

        // For bakery owners, also reject their approved bakeries when unverifying
        if (user.role === 'bakery_owner' && user.bakeries.length > 0) {
            await prisma.bakery.updateMany({
                where: {
                    ownerId: id,
                    status: 'approved',
                    deletedAt: null
                },
                data: {
                    status: 'rejected',
                    updatedBy: req.user.id
                }
            });
        }

        // For restaurant owners, also reject their approved restaurants when unverifying
        if (user.role === 'restaurant_owner' && user.restaurants.length > 0) {
            await prisma.restaurant.updateMany({
                where: {
                    ownerId: id,
                    status: 'approved',
                    deletedAt: null
                },
                data: {
                    status: 'rejected',
                    updatedBy: req.user.id
                }
            });
        }

        await prisma.user.update({
            where: { id },
            data: {
                isVerified: false,
                updatedBy: req.user.id
            }
        });

        return res.status(200).json({
            status: 'success',
            message: 'User unverified successfully'
        });
    } catch (error) {
        console.error('Unverify user error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while unverifying user'
        });
    }
});

// Change User Role
router.put('/users/:id/role', async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        if (!role) {
            return res.status(400).json({
                status: 'fail',
                message: 'Role is required'
            });
        }

        // Validate role
        const validRoles = ['customer', 'bakery_owner', 'restaurant_owner', 'driver', 'admin'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({
                status: 'fail',
                message: `Invalid role. Must be one of: ${validRoles.join(', ')}`
            });
        }

        const user = await prisma.user.findUnique({
            where: { id }
        });

        if (!user) {
            return res.status(404).json({
                status: 'fail',
                message: 'User not found'
            });
        }

        // Prevent changing admin role
        if (user.role === 'admin' && role !== 'admin') {
            return res.status(403).json({
                status: 'fail',
                message: 'Cannot change admin user role'
            });
        }

        // Prevent changing to admin role
        if (role === 'admin' && user.role !== 'admin') {
            return res.status(403).json({
                status: 'fail',
                message: 'Cannot change user to admin role'
            });
        }

        await prisma.user.update({
            where: { id },
            data: {
                role: role,
                updatedBy: req.user.id
            }
        });

        return res.status(200).json({
            status: 'success',
            message: `User role changed to ${role} successfully`
        });
    } catch (error) {
        console.error('Change user role error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while changing user role'
        });
    }
});

router.delete('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.user.update({
            where: { id },
            data: {
                deletedAt: new Date()
            }
        });

        return res.status(200).json({
            status: 'success',
            message: 'User deleted successfully'
        });
    } catch (error) {
        console.error('Delete user error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while deleting user'
        });
    }
});

// Vendors Management
router.get('/vendors', async (req, res) => {
    try {
        const { type, status, city, search, page = 1, limit = 20 } = req.query;

        const whereClause = {
            deletedAt: null
        };

        if (type === 'bakery') {
            const bakeryWhere = { ...whereClause };
            if (status) bakeryWhere.status = status;
            if (city) bakeryWhere.city = city;
            if (search) {
                bakeryWhere.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } }
                ];
            }

            const skip = (parseInt(page) - 1) * parseInt(limit);
            const [bakeries, total] = await Promise.all([
                prisma.bakery.findMany({
                    where: bakeryWhere,
                    skip,
                    take: parseInt(limit),
                    orderBy: { createdAt: 'desc' },
                    include: {
                        owner: {
                            select: {
                                id: true,
                                email: true,
                                fullName: true,
                            }
                        }
                    }
                }),
                prisma.bakery.count({ where: bakeryWhere })
            ]);

            const vendors = bakeries.map(b => ({
                ...b,
                type: 'bakery',
                ownerName: b.owner?.fullName,
                ownerEmail: b.owner?.email,
                averageRating: b.averageRating ?? 0,
                reviewCount: b.reviewCount ?? 0,
            }));

            return res.status(200).json({
                status: 'success',
                data: {
                    vendors,
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(total / parseInt(limit))
                }
            });
        } else if (type === 'restaurant') {
            const restaurantWhere = { ...whereClause };
            if (status) restaurantWhere.status = status;
            if (city) restaurantWhere.city = city;
            if (search) {
                restaurantWhere.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } }
                ];
            }

            const skip = (parseInt(page) - 1) * parseInt(limit);
            const [restaurants, total] = await Promise.all([
                prisma.restaurant.findMany({
                    where: restaurantWhere,
                    skip,
                    take: parseInt(limit),
                    orderBy: { createdAt: 'desc' },
                    include: {
                        owner: {
                            select: {
                                id: true,
                                email: true,
                                fullName: true,
                            }
                        }
                    }
                }),
                prisma.restaurant.count({ where: restaurantWhere })
            ]);

            const vendors = restaurants.map(r => ({
                ...r,
                type: 'restaurant',
                ownerName: r.owner?.fullName,
                ownerEmail: r.owner?.email,
                averageRating: r.averageRating ?? 0,
                reviewCount: r.reviewCount ?? 0,
            }));

            return res.status(200).json({
                status: 'success',
                data: {
                    vendors,
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(total / parseInt(limit))
                }
            });
        } else {
            // Get both
            const skip = (parseInt(page) - 1) * parseInt(limit);
            const [bakeries, restaurants, bakeryTotal, restaurantTotal] = await Promise.all([
                prisma.bakery.findMany({
                    where: status ? { ...whereClause, status } : whereClause,
                    skip: Math.floor(skip / 2),
                    take: Math.floor(parseInt(limit) / 2),
                    orderBy: { createdAt: 'desc' },
                    include: {
                        owner: {
                            select: {
                                id: true,
                                email: true,
                                fullName: true,
                            }
                        }
                    }
                }),
                prisma.restaurant.findMany({
                    where: status ? { ...whereClause, status } : whereClause,
                    skip: Math.floor(skip / 2),
                    take: Math.ceil(parseInt(limit) / 2),
                    orderBy: { createdAt: 'desc' },
                    include: {
                        owner: {
                            select: {
                                id: true,
                                email: true,
                                fullName: true,
                            }
                        }
                    }
                }),
                prisma.bakery.count({ where: status ? { ...whereClause, status } : whereClause }),
                prisma.restaurant.count({ where: status ? { ...whereClause, status } : whereClause })
            ]);

            const vendors = [
                ...bakeries.map(b => ({
                    ...b,
                    type: 'bakery',
                    ownerName: b.owner?.fullName,
                    ownerEmail: b.owner?.email,
                    averageRating: b.averageRating ?? 0,
                    reviewCount: b.reviewCount ?? 0,
                })),
                ...restaurants.map(r => ({
                    ...r,
                    type: 'restaurant',
                    ownerName: r.owner?.fullName,
                    ownerEmail: r.owner?.email,
                    averageRating: r.averageRating ?? 0,
                    reviewCount: r.reviewCount ?? 0,
                }))
            ].slice(0, parseInt(limit));

            const total = bakeryTotal + restaurantTotal;

            return res.status(200).json({
                status: 'success',
                data: {
                    vendors,
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(total / parseInt(limit))
                }
            });
        }
    } catch (error) {
        console.error('Get vendors error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching vendors'
        });
    }
});

router.get('/vendors/pending', async (req, res) => {
    try {
        const { type, city, search, page = 1, limit = 20 } = req.query;

        const whereClause = {
            status: 'pending_approval',
            deletedAt: null
        };

        if (city) whereClause.city = city;
        if (search) {
            whereClause.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } }
            ];
        }

        if (type === 'bakery') {
            const skip = (parseInt(page) - 1) * parseInt(limit);
            const [bakeries, total] = await Promise.all([
                prisma.bakery.findMany({
                    where: whereClause,
                    skip,
                    take: parseInt(limit),
                    orderBy: { createdAt: 'desc' },
                    include: {
                        owner: {
                            select: {
                                id: true,
                                email: true,
                                fullName: true,
                            }
                        }
                    }
                }),
                prisma.bakery.count({ where: whereClause })
            ]);

            const vendors = bakeries.map(b => ({
                ...b,
                type: 'bakery',
                ownerName: b.owner?.fullName,
                ownerEmail: b.owner?.email,
                averageRating: b.averageRating ?? 0,
                reviewCount: b.reviewCount ?? 0,
            }));

            return res.status(200).json({
                status: 'success',
                data: {
                    vendors,
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(total / parseInt(limit))
                }
            });
        } else if (type === 'restaurant') {
            const skip = (parseInt(page) - 1) * parseInt(limit);
            const [restaurants, total] = await Promise.all([
                prisma.restaurant.findMany({
                    where: whereClause,
                    skip,
                    take: parseInt(limit),
                    orderBy: { createdAt: 'desc' },
                    include: {
                        owner: {
                            select: {
                                id: true,
                                email: true,
                                fullName: true,
                            }
                        }
                    }
                }),
                prisma.restaurant.count({ where: whereClause })
            ]);

            const vendors = restaurants.map(r => ({
                ...r,
                type: 'restaurant',
                ownerName: r.owner?.fullName,
                ownerEmail: r.owner?.email,
                averageRating: r.averageRating ?? 0,
                reviewCount: r.reviewCount ?? 0,
            }));

            return res.status(200).json({
                status: 'success',
                data: {
                    vendors,
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(total / parseInt(limit))
                }
            });
        } else {
            // Get both bakeries and restaurants, plus bakery owner accounts with pending bakeries
            const skip = (parseInt(page) - 1) * parseInt(limit);
            const [bakeries, restaurants, bakeryOwners, bakeryTotal, restaurantTotal] = await Promise.all([
                prisma.bakery.findMany({
                    where: whereClause,
                    skip: Math.floor(skip / 2),
                    take: Math.floor(parseInt(limit) / 2),
                    orderBy: { createdAt: 'desc' },
                    include: {
                        owner: {
                            select: {
                                id: true,
                                email: true,
                                fullName: true,
                            }
                        }
                    }
                }),
                prisma.restaurant.findMany({
                    where: whereClause,
                    skip: Math.floor(skip / 2),
                    take: Math.ceil(parseInt(limit) / 2),
                    orderBy: { createdAt: 'desc' },
                    include: {
                        owner: {
                            select: {
                                id: true,
                                email: true,
                                fullName: true,
                            }
                        }
                    }
                }),
                // Get bakery owner users who have pending bakeries
                prisma.user.findMany({
                    where: {
                        role: 'bakery_owner',
                        deletedAt: null,
                        bakeries: {
                            some: {
                                status: 'pending_approval',
                                deletedAt: null
                            }
                        }
                    },
                    include: {
                        bakeries: {
                            where: {
                                status: 'pending_approval',
                                deletedAt: null
                            },
                            take: 1,
                            orderBy: { createdAt: 'desc' }
                        }
                    },
                    orderBy: { createdAt: 'desc' }
                }),
                prisma.bakery.count({ where: whereClause }),
                prisma.restaurant.count({ where: whereClause })
            ]);

            // Map bakery owner users to vendor format
            const ownerVendors = bakeryOwners.map(owner => {
                const pendingBakery = owner.bakeries?.[0];
                return {
                    id: owner.id,
                    name: owner.fullName || owner.username || 'Bakery Owner',
                    description: `Bakery Owner Account - ${pendingBakery?.name || 'Pending Bakery Registration'}`,
                    type: 'bakery_owner',
                    status: 'pending_approval',
                    addressLine1: pendingBakery?.addressLine1 || '',
                    addressLine2: pendingBakery?.addressLine2 || null,
                    city: pendingBakery?.city || '',
                    postalCode: pendingBakery?.postalCode || '',
                    country: pendingBakery?.country || 'Saudi Arabia',
                    phoneNumber: owner.phoneNumber || '',
                    email: owner.email || null,
                    logoUrl: pendingBakery?.logoUrl || owner.profilePictureUrl || null,
                    coverImageUrl: pendingBakery?.coverImageUrl || null,
                    operatingHours: pendingBakery?.operatingHours || null,
                    ownerId: owner.id,
                    ownerName: owner.fullName || owner.username,
                    ownerEmail: owner.email,
                    averageRating: 0,
                    reviewCount: 0,
                    createdAt: owner.createdAt,
                    updatedAt: owner.updatedAt,
                    deletedAt: owner.deletedAt,
                    bakeryId: pendingBakery?.id // Store bakery ID for reference
                };
            });

            const vendors = [
                ...bakeries.map(b => ({
                    ...b,
                    type: 'bakery',
                    ownerName: b.owner?.fullName,
                    ownerEmail: b.owner?.email,
                    averageRating: b.averageRating ?? 0,
                    reviewCount: b.reviewCount ?? 0,
                })),
                ...restaurants.map(r => ({
                    ...r,
                    type: 'restaurant',
                    ownerName: r.owner?.fullName,
                    ownerEmail: r.owner?.email,
                    averageRating: r.averageRating ?? 0,
                    reviewCount: r.reviewCount ?? 0,
                })),
                ...ownerVendors
            ].slice(0, parseInt(limit));

            const total = bakeryTotal + restaurantTotal + ownerVendors.length;

            return res.status(200).json({
                status: 'success',
                data: {
                    vendors,
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(total / parseInt(limit))
                }
            });
        }
    } catch (error) {
        console.error('Get pending vendors error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching pending vendors'
        });
    }
});

router.get('/vendors/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Try bakery first
        let vendor = await prisma.bakery.findUnique({
            where: { id },
            include: {
                owner: {
                    select: {
                        id: true,
                        email: true,
                        fullName: true,
                    }
                }
            }
        });

        if (vendor) {
            vendor = {
                ...vendor,
                type: 'bakery',
                ownerName: vendor.owner?.fullName,
                ownerEmail: vendor.owner?.email,
                averageRating: vendor.averageRating ?? 0,
                reviewCount: vendor.reviewCount ?? 0,
            };
            return res.status(200).json({
                status: 'success',
                data: vendor
            });
        }

        // Try restaurant
        vendor = await prisma.restaurant.findUnique({
            where: { id },
            include: {
                owner: {
                    select: {
                        id: true,
                        email: true,
                        fullName: true,
                    }
                }
            }
        });

        if (vendor) {
            vendor = {
                ...vendor,
                type: 'restaurant',
                ownerName: vendor.owner?.fullName,
                ownerEmail: vendor.owner?.email,
                averageRating: vendor.averageRating ?? 0,
                reviewCount: vendor.reviewCount ?? 0,
            };
            return res.status(200).json({
                status: 'success',
                data: vendor
            });
        }

        // Try bakery owner user account
        const bakeryOwner = await prisma.user.findUnique({
            where: { id },
            include: {
                bakeries: {
                    where: {
                        status: 'pending_approval',
                        deletedAt: null
                    },
                    take: 1,
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (bakeryOwner && bakeryOwner.role === 'bakery_owner') {
            const pendingBakery = bakeryOwner.bakeries?.[0];
            vendor = {
                id: bakeryOwner.id,
                name: bakeryOwner.fullName || bakeryOwner.username || 'Bakery Owner',
                description: `Bakery Owner Account - ${pendingBakery?.name || 'Pending Bakery Registration'}`,
                type: 'bakery_owner',
                status: 'pending_approval',
                addressLine1: pendingBakery?.addressLine1 || '',
                addressLine2: pendingBakery?.addressLine2 || null,
                city: pendingBakery?.city || '',
                postalCode: pendingBakery?.postalCode || '',
                country: pendingBakery?.country || 'Saudi Arabia',
                phoneNumber: bakeryOwner.phoneNumber || '',
                email: bakeryOwner.email || null,
                logoUrl: pendingBakery?.logoUrl || bakeryOwner.profilePictureUrl || null,
                coverImageUrl: pendingBakery?.coverImageUrl || null,
                operatingHours: pendingBakery?.operatingHours || null,
                ownerId: bakeryOwner.id,
                ownerName: bakeryOwner.fullName || bakeryOwner.username,
                ownerEmail: bakeryOwner.email,
                averageRating: 0,
                reviewCount: 0,
                createdAt: bakeryOwner.createdAt,
                updatedAt: bakeryOwner.updatedAt,
                deletedAt: bakeryOwner.deletedAt,
                bakeryId: pendingBakery?.id
            };
            return res.status(200).json({
                status: 'success',
                data: vendor
            });
        }

        return res.status(404).json({
            status: 'fail',
            message: 'Vendor not found'
        });
    } catch (error) {
        console.error('Get vendor error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching vendor'
        });
    }
});

router.put('/vendors/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;

        // Try bakery first
        let vendor = await prisma.bakery.findUnique({ where: { id }, include: { owner: true } });
        if (vendor) {
            await prisma.bakery.update({
                where: { id },
                data: { status: 'approved', updatedBy: req.user.id }
            });
            // Check if owner has all bakeries approved, then verify the user
            if (vendor.ownerId) {
                const pendingCount = await prisma.bakery.count({
                    where: {
                        ownerId: vendor.ownerId,
                        status: 'pending_approval',
                        deletedAt: null
                    }
                });
                if (pendingCount === 0) {
                    await prisma.user.update({
                        where: { id: vendor.ownerId },
                        data: { isVerified: true, updatedBy: req.user.id }
                    });
                }
            }
            return res.status(200).json({
                status: 'success',
                message: 'Vendor approved successfully'
            });
        }

        // Try restaurant
        vendor = await prisma.restaurant.findUnique({ where: { id }, include: { owner: true } });
        if (vendor) {
            await prisma.restaurant.update({
                where: { id },
                data: { status: 'approved', updatedBy: req.user.id }
            });
            // Check if owner has all restaurants approved, then verify the user
            if (vendor.ownerId) {
                const pendingCount = await prisma.restaurant.count({
                    where: {
                        ownerId: vendor.ownerId,
                        status: 'pending_approval',
                        deletedAt: null
                    }
                });
                if (pendingCount === 0) {
                    await prisma.user.update({
                        where: { id: vendor.ownerId },
                        data: { isVerified: true, updatedBy: req.user.id }
                    });
                }
            }
            return res.status(200).json({
                status: 'success',
                message: 'Vendor approved successfully'
            });
        }

        // Try bakery owner user account
        const bakeryOwner = await prisma.user.findUnique({
            where: { id },
            include: {
                bakeries: {
                    where: {
                        status: 'pending_approval',
                        deletedAt: null
                    }
                }
            }
        });

        if (bakeryOwner && bakeryOwner.role === 'bakery_owner') {
            // Approve all pending bakeries for this owner
            await prisma.bakery.updateMany({
                where: {
                    ownerId: id,
                    status: 'pending_approval',
                    deletedAt: null
                },
                data: {
                    status: 'approved',
                    updatedBy: req.user.id
                }
            });
            // Mark user as verified
            await prisma.user.update({
                where: { id },
                data: {
                    isVerified: true,
                    updatedBy: req.user.id
                }
            });
            return res.status(200).json({
                status: 'success',
                message: 'Bakery owner and associated bakeries approved successfully'
            });
        }

        return res.status(404).json({
            status: 'fail',
            message: 'Vendor not found'
        });
    } catch (error) {
        console.error('Approve vendor error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while approving vendor'
        });
    }
});

router.put('/vendors/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        // Try bakery first
        let vendor = await prisma.bakery.findUnique({ where: { id }, include: { owner: true } });
        if (vendor) {
            await prisma.bakery.update({
                where: { id },
                data: { status: 'rejected', updatedBy: req.user.id }
            });
            // Check if owner has any approved bakeries left, if not, unverify
            if (vendor.ownerId) {
                const approvedCount = await prisma.bakery.count({
                    where: {
                        ownerId: vendor.ownerId,
                        status: 'approved',
                        deletedAt: null
                    }
                });
                if (approvedCount === 0) {
                    await prisma.user.update({
                        where: { id: vendor.ownerId },
                        data: { isVerified: false, updatedBy: req.user.id }
                    });
                }
            }
            return res.status(200).json({
                status: 'success',
                message: 'Vendor rejected successfully'
            });
        }

        // Try restaurant
        vendor = await prisma.restaurant.findUnique({ where: { id }, include: { owner: true } });
        if (vendor) {
            await prisma.restaurant.update({
                where: { id },
                data: { status: 'rejected', updatedBy: req.user.id }
            });
            // Check if owner has any approved restaurants left, if not, unverify
            if (vendor.ownerId) {
                const approvedCount = await prisma.restaurant.count({
                    where: {
                        ownerId: vendor.ownerId,
                        status: 'approved',
                        deletedAt: null
                    }
                });
                if (approvedCount === 0) {
                    await prisma.user.update({
                        where: { id: vendor.ownerId },
                        data: { isVerified: false, updatedBy: req.user.id }
                    });
                }
            }
            return res.status(200).json({
                status: 'success',
                message: 'Vendor rejected successfully'
            });
        }

        // Try bakery owner user account
        const bakeryOwner = await prisma.user.findUnique({
            where: { id },
            include: {
                bakeries: {
                    where: {
                        status: 'pending_approval',
                        deletedAt: null
                    }
                }
            }
        });

        if (bakeryOwner && bakeryOwner.role === 'bakery_owner') {
            // Reject all pending bakeries for this owner
            await prisma.bakery.updateMany({
                where: {
                    ownerId: id,
                    status: 'pending_approval',
                    deletedAt: null
                },
                data: {
                    status: 'rejected',
                    updatedBy: req.user.id
                }
            });
            // Optionally mark user as deleted/suspended
            // await prisma.user.update({
            //     where: { id },
            //     data: { deletedAt: new Date(), updatedBy: req.user.id }
            // });
            return res.status(200).json({
                status: 'success',
                message: 'Bakery owner and associated bakeries rejected successfully'
            });
        }

        return res.status(404).json({
            status: 'fail',
            message: 'Vendor not found'
        });
    } catch (error) {
        console.error('Reject vendor error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while rejecting vendor'
        });
    }
});

// Orders Management
router.get('/orders', async (req, res) => {
    try {
        const { status, payment_status, bakery_id, restaurant_id, user_id, search, page = 1, limit = 20 } = req.query;

        const whereClause = {
            deletedAt: null
        };

        if (status) whereClause.status = status;
        if (payment_status) whereClause.paymentStatus = payment_status;
        if (bakery_id) whereClause.bakeryId = bakery_id;
        if (restaurant_id) whereClause.restaurantId = restaurant_id;
        if (user_id) whereClause.userId = user_id;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where: whereClause,
                skip,
                take: parseInt(limit),
                orderBy: { createdAt: 'desc' },
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            fullName: true,
                            phoneNumber: true,
                        }
                    },
                    bakery: {
                        select: {
                            id: true,
                            name: true,
                        }
                    },
                    restaurant: {
                        select: {
                            id: true,
                            name: true,
                        }
                    },
                    orderItems: {
                        include: {
                            product: {
                                select: {
                                    id: true,
                                    name: true,
                                }
                            }
                        }
                    }
                }
            }),
            prisma.order.count({ where: whereClause })
        ]);

        const formattedOrders = orders.map(order => ({
            ...order,
            customerName: order.user?.fullName,
            customerEmail: order.user?.email,
            customerPhone: order.user?.phoneNumber,
            bakeryName: order.bakery?.name,
            restaurantName: order.restaurant?.name,
            orderItems: order.orderItems.map(item => ({
                ...item,
                productName: item.product?.name,
            }))
        }));

        return res.status(200).json({
            status: 'success',
            data: {
                orders: formattedOrders,
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get orders error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching orders'
        });
    }
});

module.exports = router;

