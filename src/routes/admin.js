const express = require('express');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { ORDER_STATUSES, resolveOrderStatus } = require('../utils/order-status');
const {
    ALL_CITIES_KEY,
    aggregateKpisRange,
} = require('../services/kpiAggregationService');
const {
    evaluateSlaAlerts,
    processPendingAlertDeliveries,
    enqueueAlertDelivery,
    getWebhookConfig,
} = require('../services/slaAlertService');
const { DEFAULT_TIMEZONE, normalizeDateKey } = require('../services/timezoneWindowService');
const { logAuditEvent } = require('../services/auditLogService');

const router = express.Router();

const normalizeDocumentUrl = (value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;

    if (/^https?:\/\//i.test(trimmed)) return trimmed;

    if (
        trimmed.startsWith('/uploads/') ||
        trimmed.startsWith('/api/upload/uploads/') ||
        trimmed.startsWith('/v1/upload/uploads/')
    ) {
        return trimmed;
    }

    if (trimmed.startsWith('uploads/')) {
        return `/${trimmed}`;
    }

    // Legacy data sometimes stores only the filename (e.g. shared_image.jpg).
    // Serve these via the static uploads mount.
    if (!trimmed.includes('/')) {
        return `/uploads/${trimmed}`;
    }

    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

const buildVendorDocuments = (vendor, type) => {
    const documents = [];
    const seenUrls = new Set();

    const pushDocument = (url, label, kind) => {
        const normalizedUrl = normalizeDocumentUrl(url);
        if (!normalizedUrl || seenUrls.has(normalizedUrl)) return;
        seenUrls.add(normalizedUrl);
        documents.push({
            kind,
            label,
            url: normalizedUrl,
        });
    };

    if (type === 'bakery' || type === 'bakery_owner') {
        pushDocument(vendor?.commercialRegistryUrl, 'Commercial Registry', 'commercial_registry');
    }

    if (type === 'restaurant') {
        pushDocument(vendor?.commercialRegistryUrl, 'Commercial Registry', 'commercial_registry');
        pushDocument(vendor?.coverImageUrl, 'Registration Document', 'registration_document');
    }

    pushDocument(vendor?.logoUrl, 'Logo', 'logo');
    pushDocument(vendor?.coverImageUrl, 'Cover Image', 'cover_image');

    return documents;
};

const mapVendorForAdmin = (vendor, type) => {
    const mappedVendor = {
        ...vendor,
        type,
        ownerName: vendor?.owner?.fullName ?? vendor?.ownerName,
        ownerEmail: vendor?.owner?.email ?? vendor?.ownerEmail,
        averageRating: vendor?.averageRating ?? 0,
        reviewCount: vendor?.reviewCount ?? 0,
        rejectionReason: vendor?.rejectionReason ?? null,
        rejectedAt: vendor?.rejectedAt ?? null,
    };

    return {
        ...mappedVendor,
        documents: buildVendorDocuments(mappedVendor, type),
    };
};

const toSlugKey = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';

    return normalized
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, '_')
        .replace(/^_+|_+$/g, '');
};

const buildFallbackBreadTypeKey = () =>
    `bread_type_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
    return fallback;
};

const parsePositiveInt = (value, fallback, { min = 1, max = 1000 } = {}) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
};

const isValidDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());

const decimalToNumber = (value) => {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
};

const normalizeBreadTypeImageUrl = (rawUrl) => {
    if (typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;

    const encodeUploadFilename = (filename) => {
        if (!filename) return null;
        try {
            const decoded = decodeURIComponent(filename);
            return encodeURIComponent(decoded);
        } catch (_) {
            return encodeURIComponent(filename);
        }
    };

    const normalizeUploadPath = (pathname) => {
        const pathOnly = String(pathname || '').split('?')[0].split('#')[0].trim();
        if (!pathOnly) return null;

        const normalizedSlashes = pathOnly.replace(/\\/g, '/');
        const withoutPrefix = normalizedSlashes
            .replace(/^\/?(?:v1|api)\/upload\/uploads\//, 'uploads/')
            .replace(/^\/?uploads\//, 'uploads/');

        const parts = withoutPrefix.split('/').filter(Boolean);
        const filename = parts[parts.length - 1];
        const encoded = encodeUploadFilename(filename);
        if (!encoded) return null;
        return `/uploads/${encoded}`;
    };

    if (/^https?:\/\//i.test(trimmed)) {
        try {
            const parsed = new URL(trimmed);
            const isLocalHost = ['localhost', '127.0.0.1', '::1', '10.0.2.2'].includes(
                parsed.hostname.toLowerCase()
            );
            if (!isLocalHost) return trimmed;
            return normalizeUploadPath(parsed.pathname) || trimmed;
        } catch (_) {
            return trimmed;
        }
    }

    return normalizeUploadPath(trimmed) || trimmed;
};

const serializeBreadType = (item) => ({
    id: item.id,
    key: item.key,
    englishName: item.englishName,
    arabicName: item.arabicName,
    imageUrl: normalizeBreadTypeImageUrl(item.imageUrl),
    imageSource: item.imageSource,
    imageCredit: item.imageCredit,
    description: item.description,
    tags: item.tags,
    sortOrder: item.sortOrder ?? 0,
    isActive: item.isActive === true,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
});

const restockOrderInventoryForCancellation = async ({ tx, orderId, actorUserId }) => {
    const items = await tx.orderItem.findMany({
        where: { orderId },
        select: {
            productId: true,
            quantity: true,
        },
    });

    for (const item of items) {
        const quantity = Number(item.quantity || 0);
        if (!Number.isFinite(quantity) || quantity <= 0) continue;

        const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { stockQuantity: true },
        });
        if (!product) continue;

        const quantityBefore = Number(product.stockQuantity || 0);
        const quantityAfter = quantityBefore + quantity;

        await tx.product.update({
            where: { id: item.productId },
            data: {
                stockQuantity: { increment: quantity },
                updatedBy: actorUserId,
            },
        });

        await tx.inventoryMovement.create({
            data: {
                productId: item.productId,
                orderId,
                movementType: 'release',
                quantityBefore,
                quantityDelta: quantity,
                quantityAfter,
                reason: 'order_cancelled_by_admin',
                actorUserId,
            },
        });
    }
};

// Admin Auth Routes (public)
router.post('/auth/login', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const password = String(req.body?.password || '');

        if (!email || !password) {
            return res.status(400).json({
                status: 'fail',
                message: 'Email and password are required'
            });
        }

        const user = await prisma.user.findFirst({
            where: {
                email: {
                    equals: email,
                    mode: 'insensitive',
                },
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

// Simple logout endpoint
router.post('/auth/logout', (req, res) => {
    return res.status(200).json({ status: 'success', message: 'Logged out' });
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

router.get('/bread-types', async (req, res) => {
    try {
        const {
            q,
            includeInactive = 'true',
            page = 1,
            limit = 200,
        } = req.query;

        const pageNumber = Math.max(Number.parseInt(page, 10) || 1, 1);
        const limitNumber = Math.min(Math.max(Number.parseInt(limit, 10) || 200, 1), 500);
        const skip = (pageNumber - 1) * limitNumber;
        const shouldIncludeInactive = parseBoolean(includeInactive, true);

        const where = {
            deletedAt: null,
            ...(shouldIncludeInactive ? {} : { isActive: true }),
            ...(q
                ? {
                    OR: [
                        { key: { contains: q, mode: 'insensitive' } },
                        { englishName: { contains: q, mode: 'insensitive' } },
                        { arabicName: { contains: q, mode: 'insensitive' } },
                    ],
                }
                : {}),
        };

        const [items, total] = await Promise.all([
            prisma.breadTypeCatalog.findMany({
                where,
                orderBy: [{ sortOrder: 'asc' }, { englishName: 'asc' }],
                skip,
                take: limitNumber,
            }),
            prisma.breadTypeCatalog.count({ where }),
        ]);

        return res.status(200).json({
            status: 'success',
            data: {
                breadTypes: items.map(serializeBreadType),
                pagination: {
                    total,
                    page: pageNumber,
                    limit: limitNumber,
                    pages: Math.ceil(total / limitNumber),
                },
            },
        });
    } catch (error) {
        console.error('Admin list bread types error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while fetching bread types',
        });
    }
});

router.post('/bread-types', async (req, res) => {
    try {
        const {
            key,
            englishName,
            arabicName,
            imageUrl,
            imageSource,
            imageCredit,
            description,
            tags,
            sortOrder,
            isActive = true,
        } = req.body;

        const normalizedArabicName = String(arabicName || '').trim();
        const normalizedEnglishNameInput = String(englishName || '').trim();
        const normalizedEnglishName =
            normalizedEnglishNameInput || normalizedArabicName;
        const normalizedKeyCandidate = toSlugKey(
            key || normalizedEnglishNameInput || normalizedArabicName
        );
        const normalizedKey = normalizedKeyCandidate || buildFallbackBreadTypeKey();

        if (!normalizedEnglishName) {
            return res.status(400).json({
                status: 'fail',
                message: 'Provide at least one name (englishName or arabicName).',
            });
        }

        const payload = {
            key: normalizedKey,
            englishName: normalizedEnglishName,
            arabicName: normalizedArabicName || null,
            imageUrl: typeof imageUrl === 'string' ? imageUrl.trim() || null : null,
            imageSource: typeof imageSource === 'string' ? imageSource.trim() || null : null,
            imageCredit: typeof imageCredit === 'string' ? imageCredit.trim() || null : null,
            description: typeof description === 'string' ? description.trim() || null : null,
            tags: Array.isArray(tags) ? tags : null,
            sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
            isActive: parseBoolean(isActive, true),
            updatedBy: req.user.id,
            updatedAt: new Date(),
        };

        const existing = await prisma.breadTypeCatalog.findUnique({
            where: { key: normalizedKey },
        });

        if (existing) {
            const updated = await prisma.breadTypeCatalog.update({
                where: { id: existing.id },
                data: {
                    ...payload,
                    // Keep original creator metadata.
                    createdBy: existing.createdBy || req.user.id,
                    // Restore soft-deleted entries when key is reused.
                    deletedAt: null,
                },
            });

            return res.status(200).json({
                status: 'success',
                message: 'Bread type already existed and was updated',
                data: serializeBreadType(updated),
            });
        }

        const created = await prisma.breadTypeCatalog.create({
            data: {
                ...payload,
                createdBy: req.user.id,
            },
        });

        return res.status(201).json({
            status: 'success',
            data: serializeBreadType(created),
        });
    } catch (error) {
        if (error?.code === 'P2002') {
            return res.status(409).json({
                status: 'fail',
                message: 'Bread type already exists. Try changing the key or name.',
            });
        }
        console.error('Admin create bread type error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while creating bread type',
        });
    }
});

router.put('/bread-types/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            key,
            englishName,
            arabicName,
            imageUrl,
            imageSource,
            imageCredit,
            description,
            tags,
            sortOrder,
            isActive,
        } = req.body;

        const existing = await prisma.breadTypeCatalog.findFirst({
            where: { id, deletedAt: null },
        });

        if (!existing) {
            return res.status(404).json({
                status: 'fail',
                message: 'Bread type not found',
            });
        }

        const updateData = {
            ...(key !== undefined && { key: toSlugKey(key || existing.key) || existing.key }),
            ...(englishName !== undefined && { englishName: String(englishName || '').trim() || existing.englishName }),
            ...(arabicName !== undefined && { arabicName: typeof arabicName === 'string' ? arabicName.trim() || null : null }),
            ...(imageUrl !== undefined && { imageUrl: typeof imageUrl === 'string' ? imageUrl.trim() || null : null }),
            ...(imageSource !== undefined && { imageSource: typeof imageSource === 'string' ? imageSource.trim() || null : null }),
            ...(imageCredit !== undefined && { imageCredit: typeof imageCredit === 'string' ? imageCredit.trim() || null : null }),
            ...(description !== undefined && { description: typeof description === 'string' ? description.trim() || null : null }),
            ...(tags !== undefined && { tags: Array.isArray(tags) ? tags : null }),
            ...(sortOrder !== undefined && { sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : existing.sortOrder }),
            ...(isActive !== undefined && { isActive: parseBoolean(isActive, existing.isActive) }),
            updatedBy: req.user.id,
            updatedAt: new Date(),
        };

        const updated = await prisma.breadTypeCatalog.update({
            where: { id },
            data: updateData,
        });

        return res.status(200).json({
            status: 'success',
            data: serializeBreadType(updated),
        });
    } catch (error) {
        if (error?.code === 'P2002') {
            return res.status(409).json({
                status: 'fail',
                message: 'Bread type key already exists',
            });
        }
        console.error('Admin update bread type error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while updating bread type',
        });
    }
});

router.delete('/bread-types/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await prisma.breadTypeCatalog.findFirst({
            where: { id, deletedAt: null },
        });

        if (!existing) {
            return res.status(404).json({
                status: 'fail',
                message: 'Bread type not found',
            });
        }

        await prisma.breadTypeCatalog.update({
            where: { id },
            data: {
                isActive: false,
                deletedAt: new Date(),
                updatedBy: req.user.id,
                updatedAt: new Date(),
            },
        });

        return res.status(200).json({
            status: 'success',
            message: 'Bread type removed successfully',
        });
    } catch (error) {
        console.error('Admin delete bread type error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while deleting bread type',
        });
    }
});

router.post('/bread-types/import', async (req, res) => {
    try {
        const list = Array.isArray(req.body?.breadTypes) ? req.body.breadTypes : [];
        if (list.length === 0) {
            return res.status(400).json({
                status: 'fail',
                message: 'breadTypes list is required',
            });
        }

        let imported = 0;
        let skipped = 0;

        for (const rawItem of list) {
            if (!rawItem || typeof rawItem !== 'object') {
                skipped += 1;
                continue;
            }

            const key = toSlugKey(rawItem.key || rawItem.englishName);
            const englishName = String(rawItem.englishName || '').trim();

            if (!key || !englishName) {
                skipped += 1;
                continue;
            }

            await prisma.breadTypeCatalog.upsert({
                where: { key },
                create: {
                    key,
                    englishName,
                    arabicName: typeof rawItem.arabicName === 'string' ? rawItem.arabicName.trim() || null : null,
                    imageUrl: typeof rawItem.imageUrl === 'string' ? rawItem.imageUrl.trim() || null : null,
                    imageSource: typeof rawItem.imageSource === 'string' ? rawItem.imageSource.trim() || null : null,
                    imageCredit: typeof rawItem.imageCredit === 'string' ? rawItem.imageCredit.trim() || null : null,
                    description: typeof rawItem.description === 'string' ? rawItem.description.trim() || null : null,
                    tags: Array.isArray(rawItem.tags) ? rawItem.tags : null,
                    sortOrder: Number.isFinite(Number(rawItem.sortOrder)) ? Number(rawItem.sortOrder) : 0,
                    isActive: parseBoolean(rawItem.isActive, true),
                    createdBy: req.user.id,
                    updatedBy: req.user.id,
                },
                update: {
                    englishName,
                    arabicName: typeof rawItem.arabicName === 'string' ? rawItem.arabicName.trim() || null : null,
                    imageUrl: typeof rawItem.imageUrl === 'string' ? rawItem.imageUrl.trim() || null : null,
                    imageSource: typeof rawItem.imageSource === 'string' ? rawItem.imageSource.trim() || null : null,
                    imageCredit: typeof rawItem.imageCredit === 'string' ? rawItem.imageCredit.trim() || null : null,
                    description: typeof rawItem.description === 'string' ? rawItem.description.trim() || null : null,
                    tags: Array.isArray(rawItem.tags) ? rawItem.tags : null,
                    sortOrder: Number.isFinite(Number(rawItem.sortOrder)) ? Number(rawItem.sortOrder) : 0,
                    isActive: parseBoolean(rawItem.isActive, true),
                    updatedBy: req.user.id,
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            imported += 1;
        }

        return res.status(200).json({
            status: 'success',
            data: {
                imported,
                skipped,
                requested: list.length,
            },
        });
    } catch (error) {
        console.error('Admin import bread types error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred while importing bread types',
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
                activeIssues: 0,
                todayOrders,
                todayRevenue: Number(todayRevenue._sum.totalAmount || 0),
            },
            userGrowth: [],
            orderTrends: [],
            topVendors: [],
            recentActivity: []
        };

        const since = new Date();
        since.setUTCDate(since.getUTCDate() - 14);
        since.setUTCHours(0, 0, 0, 0);

        const [kpiRows, activeSlaBreaches, payoutRisk, disputeRisk, dispatchRisk] = await Promise.all([
            prisma.kpiDailyFact.findMany({
                where: {
                    city: ALL_CITIES_KEY,
                    metricDate: {
                        gte: since,
                    },
                },
                orderBy: { metricDate: 'asc' },
                take: 30,
            }),
            prisma.slaAlertEvent.findMany({
                where: { status: 'active' },
                orderBy: { lastTriggeredAt: 'desc' },
                take: 10,
            }),
            prisma.payoutRequest.count({
                where: {
                    status: { in: ['requested', 'approved'] },
                    createdAt: {
                        lt: new Date(Date.now() - 24 * 60 * 60 * 1000),
                    },
                },
            }),
            prisma.disputeCase.count({
                where: {
                    status: { in: ['open', 'under_review', 'vendor_responded'] },
                    createdAt: {
                        lt: new Date(Date.now() - 24 * 60 * 60 * 1000),
                    },
                },
            }),
            prisma.dispatchJob.count({
                where: {
                    status: 'pending',
                    slaDueAt: {
                        lt: new Date(),
                    },
                },
            }),
        ]);

        const kpiTrend = kpiRows.map((row) => ({
            metricDate: row.metricDate,
            fillRate: decimalToNumber(row.fillRate),
            stockoutRate: decimalToNumber(row.stockoutRate),
            assignmentLatencySec: row.assignmentLatencySec,
            onTimeDeliveryRate: decimalToNumber(row.onTimeDeliveryRate),
            refundRatio: decimalToNumber(row.refundRatio),
            payoutAgingHours: row.payoutAgingHours,
            disputeAgingHours: row.disputeAgingHours,
            cancellationRate: decimalToNumber(row.cancellationRate),
            ordersCount: row.ordersCount,
            disputesOpenCount: row.disputesOpenCount,
        }));

        const riskCards = [
            { type: 'payout', severity: payoutRisk > 10 ? 'critical' : payoutRisk > 0 ? 'warning' : 'normal', count: payoutRisk },
            { type: 'dispute', severity: disputeRisk > 10 ? 'critical' : disputeRisk > 0 ? 'warning' : 'normal', count: disputeRisk },
            { type: 'dispatch', severity: dispatchRisk > 5 ? 'critical' : dispatchRisk > 0 ? 'warning' : 'normal', count: dispatchRisk },
        ];

        dashboardData.stats.activeIssues = activeSlaBreaches.length + riskCards.reduce((sum, item) => sum + (item.count > 0 ? 1 : 0), 0);
        dashboardData.marketplaceHealth = {
            dailyKpiTrend: kpiTrend,
            activeBreaches: activeSlaBreaches.map((breach) => ({
                id: breach.id,
                alertType: breach.alertType,
                summary: breach.summary,
                valueNumeric: decimalToNumber(breach.valueNumeric),
                valueCount: breach.valueCount,
                firstTriggeredAt: breach.firstTriggeredAt,
                lastTriggeredAt: breach.lastTriggeredAt,
            })),
            riskCards,
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

router.get('/kpis/daily', async (req, res) => {
    try {
        const {
            fromDate,
            toDate,
            city,
            page = 1,
            limit = 30,
        } = req.query;

        const where = {};
        if (fromDate || toDate) {
            if (fromDate && !isValidDateKey(fromDate)) {
                return res.status(400).json({ status: 'fail', message: 'fromDate must be YYYY-MM-DD' });
            }
            if (toDate && !isValidDateKey(toDate)) {
                return res.status(400).json({ status: 'fail', message: 'toDate must be YYYY-MM-DD' });
            }

            where.metricDate = {};
            if (fromDate) where.metricDate.gte = new Date(`${String(fromDate)}T00:00:00.000Z`);
            if (toDate) where.metricDate.lte = new Date(`${String(toDate)}T00:00:00.000Z`);
        }

        if (city) {
            const normalizedCity = String(city).trim();
            if (normalizedCity.toLowerCase() === 'all') {
                where.city = ALL_CITIES_KEY;
            } else {
                where.city = normalizedCity;
            }
        }

        const limitNumber = parsePositiveInt(limit, 30, { min: 1, max: 200 });
        const pageNumber = parsePositiveInt(page, 1, { min: 1, max: 100000 });
        const skip = (pageNumber - 1) * limitNumber;

        const [items, total] = await Promise.all([
            prisma.kpiDailyFact.findMany({
                where,
                orderBy: [{ metricDate: 'desc' }, { city: 'asc' }],
                skip,
                take: limitNumber,
            }),
            prisma.kpiDailyFact.count({ where }),
        ]);

        return res.status(200).json({
            status: 'success',
            data: {
                items: items.map((row) => ({
                    id: row.id,
                    metricDate: row.metricDate,
                    city: row.city === ALL_CITIES_KEY ? 'all' : row.city,
                    fillRate: decimalToNumber(row.fillRate),
                    stockoutRate: decimalToNumber(row.stockoutRate),
                    assignmentLatencySec: row.assignmentLatencySec,
                    onTimeDeliveryRate: decimalToNumber(row.onTimeDeliveryRate),
                    refundRatio: decimalToNumber(row.refundRatio),
                    payoutAgingHours: row.payoutAgingHours,
                    disputeAgingHours: row.disputeAgingHours,
                    cancellationRate: decimalToNumber(row.cancellationRate),
                    ordersCount: row.ordersCount,
                    disputesOpenCount: row.disputesOpenCount,
                    metadata: row.metadata || null,
                    createdAt: row.createdAt,
                    updatedAt: row.updatedAt,
                })),
                pagination: {
                    total,
                    page: pageNumber,
                    limit: limitNumber,
                    pages: Math.ceil(total / limitNumber),
                },
            },
        });
    } catch (error) {
        console.error('Admin list KPI daily error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Unable to fetch daily KPI data',
        });
    }
});

router.get('/alerts/active', async (req, res) => {
    try {
        const {
            alertType,
            status = 'active',
            page = 1,
            limit = 30,
        } = req.query;

        const where = {};
        if (alertType) where.alertType = String(alertType).trim();
        if (status && ['active', 'resolved', 'failed'].includes(String(status).trim().toLowerCase())) {
            where.status = String(status).trim().toLowerCase();
        }

        const limitNumber = parsePositiveInt(limit, 30, { min: 1, max: 200 });
        const pageNumber = parsePositiveInt(page, 1, { min: 1, max: 100000 });
        const skip = (pageNumber - 1) * limitNumber;

        const [items, total, queueByStatus] = await Promise.all([
            prisma.slaAlertEvent.findMany({
                where,
                orderBy: { lastTriggeredAt: 'desc' },
                skip,
                take: limitNumber,
            }),
            prisma.slaAlertEvent.count({ where }),
            prisma.slaAlertDelivery.groupBy({
                by: ['status'],
                _count: { status: true },
            }),
        ]);

        const queueStatusCounts = queueByStatus.reduce((acc, row) => {
            acc[row.status] = row._count.status;
            return acc;
        }, {});

        return res.status(200).json({
            status: 'success',
            data: {
                items: items.map((item) => ({
                    ...item,
                    valueNumeric: decimalToNumber(item.valueNumeric),
                })),
                pagination: {
                    total,
                    page: pageNumber,
                    limit: limitNumber,
                    pages: Math.ceil(total / limitNumber),
                },
                queue: queueStatusCounts,
            },
        });
    } catch (error) {
        console.error('Admin list active alerts error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Unable to fetch active alerts',
        });
    }
});

router.post('/kpis/backfill', async (req, res) => {
    try {
        const timeZone = String(req.body?.timeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
        const fromDate = String(req.body?.fromDate || '').trim();
        const toDate = String(req.body?.toDate || '').trim();
        const force = parseBoolean(req.body?.force, false);

        if (!isValidDateKey(fromDate) || !isValidDateKey(toDate)) {
            return res.status(400).json({
                status: 'fail',
                message: 'fromDate and toDate are required in YYYY-MM-DD format',
            });
        }

        const result = await aggregateKpisRange({
            prisma,
            fromDate: normalizeDateKey(fromDate),
            toDate: normalizeDateKey(toDate),
            timeZone,
            force,
            initiatedBy: req.user.id,
            source: 'admin_api',
        });

        await logAuditEvent({
            prisma,
            req,
            action: 'admin.kpi.backfill',
            entityType: 'kpi_aggregation_run',
            entityId: result?.run?.id || null,
            metadata: {
                fromDate,
                toDate,
                timeZone,
                force,
                skipped: result?.skipped === true,
                totalUpserted: result?.totalUpserted || 0,
            },
        });

        return res.status(200).json({
            status: 'success',
            data: {
                run: result.run,
                skipped: result.skipped,
                totalUpserted: result.totalUpserted || 0,
                dates: (result.dates || []).map((item) => ({
                    dateKey: item.dateKey,
                    upserted: item.upserted,
                    startUtc: item.window?.startUtc,
                    endUtc: item.window?.endUtc,
                })),
            },
        });
    } catch (error) {
        console.error('Admin KPI backfill error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Unable to run KPI backfill',
        });
    }
});

router.post('/alerts/test-webhook', async (req, res) => {
    try {
        const webhookConfig = getWebhookConfig();
        if (!webhookConfig.url) {
            return res.status(400).json({
                status: 'fail',
                message: 'SLA alert webhook URL is not configured',
            });
        }

        const eventType = String(req.body?.eventType || 'alerts.test').trim();
        const payload = {
            type: eventType,
            status: 'test',
            summary: String(req.body?.summary || 'Admin triggered SLA webhook test'),
            valueCount: Number(req.body?.valueCount || 0),
            valueNumeric: Number(req.body?.valueNumeric || 0),
            metadata: req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : null,
            occurredAt: new Date().toISOString(),
            triggeredBy: req.user.id,
        };

        const delivery = await enqueueAlertDelivery({
            prisma,
            eventType,
            alertEventId: null,
            payload,
            metadata: {
                source: 'admin_test_webhook',
                userId: req.user.id,
            },
        });

        const processNow = parseBoolean(req.body?.processNow, true);
        let processResult = null;
        if (processNow) {
            processResult = await processPendingAlertDeliveries({
                prisma,
                workerId: `admin-test-${req.user.id}`,
                limit: 5,
            });
        }

        await logAuditEvent({
            prisma,
            req,
            action: 'admin.alerts.test_webhook',
            entityType: 'sla_alert_delivery',
            entityId: delivery?.id || null,
            metadata: {
                eventType,
                processNow,
                webhookDestination: webhookConfig.url,
                processed: processResult?.processed || 0,
                failed: processResult?.failed || 0,
            },
        });

        return res.status(200).json({
            status: 'success',
            data: {
                delivery,
                processResult,
            },
        });
    } catch (error) {
        console.error('Admin test alert webhook error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Unable to send test webhook',
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
                        deletedAt: null
                    }
                },
                restaurants: {
                    where: {
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

        await prisma.$transaction(async (tx) => {
            // Admin verification should also reactivate the user account.
            await tx.user.update({
                where: { id },
                data: {
                    isVerified: true,
                    deletedAt: null,
                    updatedBy: req.user.id
                }
            });

            // Bakery owners must have an approved bakery profile after admin verification
            // so they can access vendor endpoints immediately.
            if (user.role === 'bakery_owner') {
                if (user.bakeries.length > 0) {
                    await tx.bakery.updateMany({
                        where: {
                            ownerId: id,
                            status: { in: ['pending_approval', 'rejected'] },
                            deletedAt: null
                        },
                        data: {
                            status: 'approved',
                            updatedBy: req.user.id
                        }
                    });
                } else {
                    const fallbackName = (user.fullName || user.username || 'Bakery Owner').trim();
                    await tx.bakery.create({
                        data: {
                            ownerId: id,
                            name: fallbackName,
                            description: 'Auto-created by admin verification.',
                            addressLine1: 'Address not provided',
                            city: 'Amman',
                            postalCode: '00000',
                            country: 'Jordan',
                            phoneNumber: user.phoneNumber || '0000000000',
                            email: user.email,
                            status: 'approved',
                            createdBy: req.user.id,
                            updatedBy: req.user.id
                        }
                    });
                }
            }

            // Restaurant owners receive the same activation behavior.
            if (user.role === 'restaurant_owner') {
                if (user.restaurants.length > 0) {
                    await tx.restaurant.updateMany({
                        where: {
                            ownerId: id,
                            status: { in: ['pending_approval', 'rejected'] },
                            deletedAt: null
                        },
                        data: {
                            status: 'approved',
                            updatedBy: req.user.id
                        }
                    });
                } else {
                    const fallbackName = (user.fullName || user.username || 'Restaurant Owner').trim();
                    await tx.restaurant.create({
                        data: {
                            ownerId: id,
                            name: fallbackName,
                            description: 'Auto-created by admin verification.',
                            addressLine1: 'Address not provided',
                            city: 'Amman',
                            postalCode: '00000',
                            country: 'Jordan',
                            phoneNumber: user.phoneNumber || '0000000000',
                            email: user.email,
                            status: 'approved',
                            createdBy: req.user.id,
                            updatedBy: req.user.id
                        }
                    });
                }
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

// Update vendor currency (bakery or restaurant)
router.put('/vendors/:id/currency', async (req, res) => {
    try {
        const { id } = req.params;
        const { currency } = req.body;
        const allowed = ['jod', 'usd', 'sar', 'aed', 'eur', 'gbp'];
        if (!currency || !allowed.includes(currency.toLowerCase())) {
            return res.status(400).json({ status: 'fail', message: 'Invalid currency' });
        }

        // Determine type by existence
        const bakery = await prisma.bakery.findUnique({ where: { id } });
        const restaurant = bakery ? null : await prisma.restaurant.findUnique({ where: { id } });

        if (!bakery && !restaurant) {
            return res.status(404).json({ status: 'fail', message: 'Vendor not found' });
        }

        if (bakery) {
            await prisma.bakery.update({
                where: { id },
                data: { currency: currency.toLowerCase() }
            });
        } else if (restaurant) {
            await prisma.restaurant.update({
                where: { id },
                data: { currency: currency.toLowerCase() }
            });
        }

        return res.status(200).json({ status: 'success' });
    } catch (error) {
        console.error('Update vendor currency error:', error);
        return res.status(500).json({ status: 'error', message: 'Failed to update currency' });
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

            const vendors = bakeries.map((bakery) => mapVendorForAdmin(bakery, 'bakery'));

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

            const vendors = restaurants.map((restaurant) =>
                mapVendorForAdmin(restaurant, 'restaurant')
            );

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
                ...bakeries.map((bakery) => mapVendorForAdmin(bakery, 'bakery')),
                ...restaurants.map((restaurant) =>
                    mapVendorForAdmin(restaurant, 'restaurant')
                ),
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

            const vendors = bakeries.map((bakery) => mapVendorForAdmin(bakery, 'bakery'));

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

            const vendors = restaurants.map((restaurant) =>
                mapVendorForAdmin(restaurant, 'restaurant')
            );

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
                return mapVendorForAdmin({
                    id: owner.id,
                    name: owner.fullName || owner.username || 'Bakery Owner',
                    description: `Bakery Owner Account - ${pendingBakery?.name || 'Pending Bakery Registration'}`,
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
                    commercialRegistryUrl: pendingBakery?.commercialRegistryUrl || null,
                    rejectionReason: pendingBakery?.rejectionReason || null,
                    rejectedAt: pendingBakery?.rejectedAt || null,
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
                }, 'bakery_owner');
            });

            const vendors = [
                ...bakeries.map((bakery) => mapVendorForAdmin(bakery, 'bakery')),
                ...restaurants.map((restaurant) =>
                    mapVendorForAdmin(restaurant, 'restaurant')
                ),
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

// Vendor status actions (approve/reject/suspend/activate)
const upsertVendorStatus = async (id, status) => {
    const bakery = await prisma.bakery.findUnique({ where: { id } });
    if (bakery) {
        return prisma.bakery.update({
            where: { id },
            data: {
                status,
                deletedAt: null,
                ...(status === 'approved'
                    ? { rejectionReason: null, rejectedAt: null }
                    : { rejectedAt: new Date() }),
            },
        });
    }
    const restaurant = await prisma.restaurant.findUnique({ where: { id } });
    if (restaurant) {
        return prisma.restaurant.update({
            where: { id },
            data: {
                status,
                deletedAt: null,
                ...(status === 'approved'
                    ? { rejectionReason: null, rejectedAt: null }
                    : { rejectedAt: new Date() }),
            },
        });
    }
    throw new Error('Vendor not found');
};

['suspend', 'activate'].forEach((action) => {
    router.put(`/vendors/:vendorId/${action}`, async (req, res) => {
        try {
            const statusMap = {
                suspend: 'rejected', // Prisma enum only supports approved/pending_approval/rejected
                activate: 'approved',
            };
            await upsertVendorStatus(req.params.vendorId, statusMap[action]);
            return res.status(200).json({ status: 'success', message: `Vendor ${action}d` });
        } catch (error) {
            console.error(`${action} vendor error:`, error);
            return res.status(404).json({
                status: 'fail',
                message: 'Vendor not found'
            });
        }
    });
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
            vendor = mapVendorForAdmin(vendor, 'bakery');
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
            vendor = mapVendorForAdmin(vendor, 'restaurant');
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
            vendor = mapVendorForAdmin({
                id: bakeryOwner.id,
                name: bakeryOwner.fullName || bakeryOwner.username || 'Bakery Owner',
                description: `Bakery Owner Account - ${pendingBakery?.name || 'Pending Bakery Registration'}`,
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
                commercialRegistryUrl: pendingBakery?.commercialRegistryUrl || null,
                rejectionReason: pendingBakery?.rejectionReason || null,
                rejectedAt: pendingBakery?.rejectedAt || null,
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
            }, 'bakery_owner');
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
                data: {
                    status: 'approved',
                    rejectionReason: null,
                    rejectedAt: null,
                    updatedBy: req.user.id,
                }
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
                data: {
                    status: 'approved',
                    rejectionReason: null,
                    rejectedAt: null,
                    updatedBy: req.user.id,
                }
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
                    rejectionReason: null,
                    rejectedAt: null,
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
        const reason = String(req.body?.reason || '').trim();
        if (!reason) {
            return res.status(400).json({
                status: 'fail',
                message: 'Rejection reason is required',
            });
        }

        // Try bakery first
        let vendor = await prisma.bakery.findUnique({ where: { id }, include: { owner: true } });
        if (vendor) {
            await prisma.bakery.update({
                where: { id },
                data: {
                    status: 'rejected',
                    rejectionReason: reason,
                    rejectedAt: new Date(),
                    updatedBy: req.user.id,
                }
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
                data: {
                    status: 'rejected',
                    rejectionReason: reason,
                    rejectedAt: new Date(),
                    updatedBy: req.user.id,
                }
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
                    rejectionReason: reason,
                    rejectedAt: new Date(),
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

        if (status) {
            const resolvedStatus = resolveOrderStatus(status);
            if (!resolvedStatus) {
                return res.status(400).json({
                    status: 'fail',
                    message: `Invalid order status. Allowed values: ${ORDER_STATUSES.join(', ')}`
                });
            }
            whereClause.status = resolvedStatus;
        }
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
            paymentErrorMessage: order.paymentErrorMessage,
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

// Admin: get order by id
router.get('/orders/:orderId', async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.orderId },
            include: {
                orderItems: true,
                user: true,
                bakery: true,
                restaurant: true
            }
        });
        if (!order) {
            return res.status(404).json({ status: 'fail', message: 'Order not found' });
        }
        return res.status(200).json({ status: 'success', data: { order } });
    } catch (error) {
        console.error('Admin get order error:', error);
        return res.status(500).json({ status: 'error', message: 'An error occurred while fetching order' });
    }
});

// Admin: update order status
router.put('/orders/:orderId/status', async (req, res) => {
    try {
        const resolvedStatus = resolveOrderStatus(req.body?.status);
        if (!resolvedStatus) {
            return res.status(400).json({
                status: 'fail',
                message: `Invalid order status. Allowed values: ${ORDER_STATUSES.join(', ')}`
            });
        }

        const order = await prisma.$transaction(async (tx) => {
            const existingOrder = await tx.order.findUnique({
                where: { id: req.params.orderId },
                select: { id: true, status: true },
            });
            if (!existingOrder) return null;

            const nextOrder = await tx.order.update({
                where: { id: req.params.orderId },
                data: { status: resolvedStatus, updatedAt: new Date(), updatedBy: req.user.id }
            });

            if (resolvedStatus === 'cancelled' && existingOrder.status !== 'cancelled') {
                await restockOrderInventoryForCancellation({
                    tx,
                    orderId: req.params.orderId,
                    actorUserId: req.user.id,
                });
                await tx.orderCancellationReason.upsert({
                    where: { orderId: req.params.orderId },
                    update: {
                        reasonCode: String(req.body?.reasonCode || 'admin_cancelled'),
                        reasonText: String(req.body?.reason || req.body?.notes || '').trim() || null,
                        cancelledByUserId: req.user.id,
                        cancelledByRole: req.user.role,
                        metadata: { source: 'admin.orders.status' },
                    },
                    create: {
                        orderId: req.params.orderId,
                        reasonCode: String(req.body?.reasonCode || 'admin_cancelled'),
                        reasonText: String(req.body?.reason || req.body?.notes || '').trim() || null,
                        cancelledByUserId: req.user.id,
                        cancelledByRole: req.user.role,
                        metadata: { source: 'admin.orders.status' },
                    },
                });
            }

            return nextOrder;
        });

        if (!order) {
            return res.status(404).json({ status: 'fail', message: 'Order not found' });
        }
        return res.status(200).json({ status: 'success', data: { order } });
    } catch (error) {
        console.error('Admin update order status error:', error);
        return res.status(500).json({ status: 'error', message: 'An error occurred while updating order status' });
    }
});

// Admin: cancel order
router.post('/orders/:orderId/cancel', async (req, res) => {
    try {
        const order = await prisma.$transaction(async (tx) => {
            const existingOrder = await tx.order.findUnique({
                where: { id: req.params.orderId },
                select: { id: true, status: true },
            });
            if (!existingOrder) return null;

            const nextOrder = await tx.order.update({
                where: { id: req.params.orderId },
                data: { status: 'cancelled', updatedAt: new Date(), updatedBy: req.user.id }
            });

            if (existingOrder.status !== 'cancelled') {
                await restockOrderInventoryForCancellation({
                    tx,
                    orderId: req.params.orderId,
                    actorUserId: req.user.id,
                });
            }

            await tx.orderCancellationReason.upsert({
                where: { orderId: req.params.orderId },
                update: {
                    reasonCode: String(req.body?.reasonCode || 'admin_cancelled'),
                    reasonText: String(req.body?.reason || req.body?.notes || '').trim() || null,
                    cancelledByUserId: req.user.id,
                    cancelledByRole: req.user.role,
                    metadata: { source: 'admin.orders.cancel' },
                },
                create: {
                    orderId: req.params.orderId,
                    reasonCode: String(req.body?.reasonCode || 'admin_cancelled'),
                    reasonText: String(req.body?.reason || req.body?.notes || '').trim() || null,
                    cancelledByUserId: req.user.id,
                    cancelledByRole: req.user.role,
                    metadata: { source: 'admin.orders.cancel' },
                },
            });

            return nextOrder;
        });

        if (!order) {
            return res.status(404).json({ status: 'fail', message: 'Order not found' });
        }
        return res.status(200).json({ status: 'success', data: { order }, message: 'Order cancelled' });
    } catch (error) {
        console.error('Admin cancel order error:', error);
        return res.status(500).json({ status: 'error', message: 'An error occurred while cancelling order' });
    }
});

module.exports = router;
