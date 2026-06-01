const express = require('express');
const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();
const reportsDir = path.join(__dirname, '../../uploads');
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidUuid = (value) =>
  typeof value === 'string' && UUID_REGEX.test(value.trim());
const successfulStatuses = new Set(['completed', 'delivered']);
const processingStatuses = new Set([
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'out_for_delivery',
]);

if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toInteger = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeAssetUrl = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const resolveRestaurantCoverImageUrl = (payload = {}) => {
  const hasDirectCover =
    Object.prototype.hasOwnProperty.call(payload, 'coverImageUrl');
  const normalizedCover = hasDirectCover
    ? normalizeAssetUrl(payload.coverImageUrl)
    : undefined;

  const registrationDocument =
    normalizeAssetUrl(payload.registrationDocumentUrl) ||
    normalizeAssetUrl(payload.commercialRegistryUrl) ||
    normalizeAssetUrl(payload.commercialRegisterPath);

  if (normalizedCover) return normalizedCover;
  if (registrationDocument) return registrationDocument;

  // Do not wipe an existing stored registration document when the client sends
  // null/empty coverImageUrl without an explicit replacement document.
  if (hasDirectCover) return undefined;

  return undefined;
};

const resolvePeriodRange = (rawPeriod) => {
  const now = new Date();
  const normalized = (rawPeriod || 'today').toString().trim().toLowerCase();
  let startDate;

  switch (normalized) {
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
    case 'today':
    default:
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
  }

  return { period: normalized, startDate, endDate: now };
};

const resolveTrendGranularity = (period, rawGranularity) => {
  const requested = (rawGranularity || '').toString().trim().toLowerCase();
  if (['hour', 'day', 'week', 'month'].includes(requested)) {
    return requested;
  }
  if (period === 'today') return 'hour';
  if (period === 'year') return 'month';
  return 'day';
};

const formatTrendBucket = (date, granularity) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');

  if (granularity === 'hour') {
    return `${year}-${month}-${day} ${hour}:00`;
  }
  if (granularity === 'month') {
    return `${year}-${month}`;
  }
  if (granularity === 'week') {
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const weekYear = weekStart.getFullYear();
    const weekMonth = String(weekStart.getMonth() + 1).padStart(2, '0');
    const weekDay = String(weekStart.getDate()).padStart(2, '0');
    return `${weekYear}-${weekMonth}-${weekDay}`;
  }
  return `${year}-${month}-${day}`;
};

const classifyStatus = (status) => {
  if (status === 'cancelled') return 'cancelled';
  if (successfulStatuses.has(status)) return 'completed';
  if (processingStatuses.has(status)) return 'processing';
  return 'pending';
};

const escapeCsv = (value) => {
  const stringValue = (value ?? '').toString();
  if (!/[,"\n]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
};

const buildExportCsv = ({ period, salesOverview, orderStatistics, popularItems }) => {
  const rows = [
    ['Metric', 'Value'],
    ['Period', period],
    ['Total Sales', salesOverview.total_sales],
    ['Total Orders', salesOverview.total_orders],
    ['Average Order Value', salesOverview.average_order_value],
    ['Pending Orders', orderStatistics.pending],
    ['Processing Orders', orderStatistics.processing],
    ['Completed Orders', orderStatistics.completed],
    ['Cancelled Orders', orderStatistics.cancelled],
    [],
    ['Top Items'],
    ['Item Name', 'Quantity Sold', 'Revenue'],
    ...popularItems.map((item) => [item.name, item.quantity_sold, item.revenue]),
  ];

  return rows.map((row) => row.map((item) => escapeCsv(item)).join(',')).join('\n');
};

const resolveManagedRestaurant = async (req) => {
  const requestedRestaurantId =
    typeof req.query.restaurantId === 'string' &&
    req.query.restaurantId.trim().length > 0
      ? req.query.restaurantId.trim()
      : null;

  if (req.user.role === 'admin') {
    if (requestedRestaurantId) {
      return prisma.restaurant.findFirst({
        where: {
          id: requestedRestaurantId,
          deletedAt: null,
        },
      });
    }

    return prisma.restaurant.findFirst({
      where: { deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
  }

  return prisma.restaurant.findFirst({
    where: {
      ownerId: req.user.id,
      deletedAt: null,
      ...(requestedRestaurantId ? { id: requestedRestaurantId } : {}),
    },
    orderBy: { updatedAt: 'desc' },
  });
};

const fetchSalesOverviewData = async ({ restaurantId, startDate, endDate }) => {
  const orders = await prisma.order.findMany({
    where: {
      restaurantId,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
      deletedAt: null,
    },
    select: {
      totalAmount: true,
      status: true,
      paymentStatus: true,
    },
  });

  let totalSales = 0;
  let successfulOrders = 0;

  orders.forEach((order) => {
    const isSuccessful =
      successfulStatuses.has(order.status) &&
      (order.paymentStatus === 'paid' || order.paymentStatus === 'refunded');
    if (!isSuccessful) return;
    successfulOrders += 1;
    totalSales += toNumber(order.totalAmount);
  });

  return {
    total_sales: Number(totalSales.toFixed(2)),
    total_orders: orders.length,
    average_order_value:
      successfulOrders > 0 ? Number((totalSales / successfulOrders).toFixed(2)) : 0,
  };
};

const fetchOrderStatisticsData = async ({ restaurantId, startDate, endDate }) => {
  const orders = await prisma.order.findMany({
    where: {
      restaurantId,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
      deletedAt: null,
    },
    select: {
      status: true,
    },
  });

  const orderStats = {
    pending: 0,
    processing: 0,
    completed: 0,
    cancelled: 0,
  };

  orders.forEach((order) => {
    const bucket = classifyStatus(order.status);
    orderStats[bucket] += 1;
  });

  return orderStats;
};

const fetchPopularItemsData = async ({
  restaurantId,
  startDate,
  endDate,
  limit = 10,
}) => {
  const orderItems = await prisma.orderItem.findMany({
    where: {
      deletedAt: null,
      order: {
        restaurantId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        status: { in: Array.from(successfulStatuses) },
        deletedAt: null,
      },
    },
    include: {
      product: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  const aggregate = new Map();

  orderItems.forEach((item) => {
    const productId = item.productId || item.product?.id || `unknown-${item.id}`;
    const current = aggregate.get(productId) || {
      product_id: productId,
      name: item.product?.name || 'Unknown Item',
      quantity_sold: 0,
      revenue: 0,
    };
    current.quantity_sold += toInteger(item.quantity);
    current.revenue += toNumber(item.subtotal);
    aggregate.set(productId, current);
  });

  return Array.from(aggregate.values())
    .sort((a, b) => b.quantity_sold - a.quantity_sold || b.revenue - a.revenue)
    .slice(0, limit)
    .map((item) => ({
      ...item,
      revenue: Number(item.revenue.toFixed(2)),
    }));
};

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

router.get('/analytics/sales-overview', authenticateToken, authorizeRole(['restaurant_owner', 'admin']), async (req, res) => {
  try {
    const restaurant = await resolveManagedRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({
        status: 'fail',
        message: 'Restaurant not found',
      });
    }

    const { period, startDate, endDate } = resolvePeriodRange(req.query.period);
    const data = await fetchSalesOverviewData({
      restaurantId: restaurant.id,
      startDate,
      endDate,
    });
    const currencyCode = (restaurant.currency || 'jod').toString().toUpperCase();

    return res.status(200).json({
      status: 'success',
      data: {
        ...data,
        currency: currencyCode,
        period,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
      },
    });
  } catch (error) {
    console.error('Restaurant analytics sales-overview error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching sales overview',
    });
  }
});

router.get('/analytics/order-statistics', authenticateToken, authorizeRole(['restaurant_owner', 'admin']), async (req, res) => {
  try {
    const restaurant = await resolveManagedRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({
        status: 'fail',
        message: 'Restaurant not found',
      });
    }

    const { startDate, endDate } = resolvePeriodRange(req.query.period);
    const data = await fetchOrderStatisticsData({
      restaurantId: restaurant.id,
      startDate,
      endDate,
    });

    return res.status(200).json({
      status: 'success',
      data,
    });
  } catch (error) {
    console.error('Restaurant analytics order-statistics error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching order statistics',
    });
  }
});

router.get('/analytics/popular-items', authenticateToken, authorizeRole(['restaurant_owner', 'admin']), async (req, res) => {
  try {
    const restaurant = await resolveManagedRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({
        status: 'fail',
        message: 'Restaurant not found',
      });
    }

    const { startDate, endDate } = resolvePeriodRange(req.query.period);
    const limit = Math.min(Math.max(toInteger(req.query.limit) || 10, 1), 50);
    const data = await fetchPopularItemsData({
      restaurantId: restaurant.id,
      startDate,
      endDate,
      limit,
    });

    return res.status(200).json({
      status: 'success',
      data,
    });
  } catch (error) {
    console.error('Restaurant analytics popular-items error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching popular items',
    });
  }
});

router.get('/analytics/revenue-breakdown', authenticateToken, authorizeRole(['restaurant_owner', 'admin']), async (req, res) => {
  try {
    const restaurant = await resolveManagedRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({
        status: 'fail',
        message: 'Restaurant not found',
      });
    }

    const { startDate, endDate } = resolvePeriodRange(req.query.period);
    const orderItems = await prisma.orderItem.findMany({
      where: {
        deletedAt: null,
        order: {
          restaurantId: restaurant.id,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
          status: { in: Array.from(successfulStatuses) },
          deletedAt: null,
        },
      },
      include: {
        product: {
          select: {
            category: {
              select: { name: true },
            },
          },
        },
      },
    });

    const grouped = new Map();
    let totalRevenue = 0;

    orderItems.forEach((item) => {
      const revenue = toNumber(item.subtotal);
      const categoryName = item.product?.category?.name || 'Uncategorized';
      grouped.set(categoryName, (grouped.get(categoryName) || 0) + revenue);
      totalRevenue += revenue;
    });

    const categories = Array.from(grouped.entries())
      .map(([category, revenue]) => ({
        category,
        revenue: Number(revenue.toFixed(2)),
        percentage:
          totalRevenue > 0 ? Number(((revenue / totalRevenue) * 100).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    return res.status(200).json({
      status: 'success',
      data: {
        total_revenue: Number(totalRevenue.toFixed(2)),
        categories,
      },
    });
  } catch (error) {
    console.error('Restaurant analytics revenue-breakdown error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching revenue breakdown',
    });
  }
});

router.get('/analytics/order-trends', authenticateToken, authorizeRole(['restaurant_owner', 'admin']), async (req, res) => {
  try {
    const restaurant = await resolveManagedRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({
        status: 'fail',
        message: 'Restaurant not found',
      });
    }

    const { period, startDate, endDate } = resolvePeriodRange(req.query.period);
    const granularity = resolveTrendGranularity(period, req.query.granularity);

    const orders = await prisma.order.findMany({
      where: {
        restaurantId: restaurant.id,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        deletedAt: null,
      },
      select: {
        createdAt: true,
        totalAmount: true,
        status: true,
        paymentStatus: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const buckets = new Map();

    orders.forEach((order) => {
      const bucket = formatTrendBucket(new Date(order.createdAt), granularity);
      const current = buckets.get(bucket) || {
        period: bucket,
        orders: 0,
        revenue: 0,
      };

      current.orders += 1;

      const isSuccessful =
        successfulStatuses.has(order.status) &&
        (order.paymentStatus === 'paid' || order.paymentStatus === 'refunded');
      if (isSuccessful) {
        current.revenue += toNumber(order.totalAmount);
      }

      buckets.set(bucket, current);
    });

    const data = Array.from(buckets.values())
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((entry) => ({
        ...entry,
        revenue: Number(entry.revenue.toFixed(2)),
      }));

    return res.status(200).json({
      status: 'success',
      data: {
        granularity,
        trends: data,
      },
    });
  } catch (error) {
    console.error('Restaurant analytics order-trends error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching order trends',
    });
  }
});

router.get('/analytics/customer-insights', authenticateToken, authorizeRole(['restaurant_owner', 'admin']), async (req, res) => {
  try {
    const restaurant = await resolveManagedRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({
        status: 'fail',
        message: 'Restaurant not found',
      });
    }

    const { startDate, endDate } = resolvePeriodRange(req.query.period);
    const ordersInPeriod = await prisma.order.findMany({
      where: {
        restaurantId: restaurant.id,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        deletedAt: null,
      },
      select: {
        userId: true,
      },
    });

    const uniqueCustomerIds = Array.from(
      new Set(ordersInPeriod.map((order) => order.userId).filter(Boolean)),
    );

    if (uniqueCustomerIds.length === 0) {
      return res.status(200).json({
        status: 'success',
        data: {
          total_customers: 0,
          new_customers: 0,
          returning_customers: 0,
          repeat_rate: 0,
        },
      });
    }

    const lifetimeOrdersByUser = await prisma.order.groupBy({
      by: ['userId'],
      where: {
        restaurantId: restaurant.id,
        userId: { in: uniqueCustomerIds },
        deletedAt: null,
      },
      _count: {
        _all: true,
      },
    });

    const countsMap = new Map(
      lifetimeOrdersByUser.map((entry) => [entry.userId, entry._count._all || 0]),
    );

    let newCustomers = 0;
    let returningCustomers = 0;

    uniqueCustomerIds.forEach((userId) => {
      const totalOrders = countsMap.get(userId) || 0;
      if (totalOrders <= 1) {
        newCustomers += 1;
      } else {
        returningCustomers += 1;
      }
    });

    const totalCustomers = uniqueCustomerIds.length;

    return res.status(200).json({
      status: 'success',
      data: {
        total_customers: totalCustomers,
        new_customers: newCustomers,
        returning_customers: returningCustomers,
        repeat_rate:
          totalCustomers > 0
            ? Number(((returningCustomers / totalCustomers) * 100).toFixed(2))
            : 0,
      },
    });
  } catch (error) {
    console.error('Restaurant analytics customer-insights error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching customer insights',
    });
  }
});

router.get('/analytics/export', authenticateToken, authorizeRole(['restaurant_owner', 'admin']), async (req, res) => {
  try {
    const restaurant = await resolveManagedRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({
        status: 'fail',
        message: 'Restaurant not found',
      });
    }

    const format = (req.query.format || 'csv').toString().trim().toLowerCase();
    const supportedFormats = ['csv', 'json', 'pdf', 'excel'];
    if (!supportedFormats.includes(format)) {
      return res.status(400).json({
        status: 'fail',
        message: `Invalid export format. Supported formats: ${supportedFormats.join(', ')}`,
      });
    }

    const { period, startDate, endDate } = resolvePeriodRange(req.query.period);
    const [salesOverview, orderStatistics, popularItems] = await Promise.all([
      fetchSalesOverviewData({
        restaurantId: restaurant.id,
        startDate,
        endDate,
      }),
      fetchOrderStatisticsData({
        restaurantId: restaurant.id,
        startDate,
        endDate,
      }),
      fetchPopularItemsData({
        restaurantId: restaurant.id,
        startDate,
        endDate,
        limit: 20,
      }),
    ]);
    const currencyCode = (restaurant.currency || 'jod').toString().toUpperCase();

    let filePath = null;
    let fileUrl = null;

    if (format === 'csv') {
      const fileName = `restaurant-analytics-${restaurant.id}-${Date.now()}.csv`;
      const absoluteFilePath = path.join(reportsDir, fileName);
      const csvContent = buildExportCsv({
        period,
        salesOverview,
        orderStatistics,
        popularItems,
      });

      fs.writeFileSync(absoluteFilePath, csvContent, 'utf8');
      filePath = fileName;
      fileUrl = `/api/upload/uploads/${fileName}`;
    }

    return res.status(200).json({
      status: 'success',
      data: {
        format,
        period,
        restaurant_id: restaurant.id,
        currency: currencyCode,
        generated_at: new Date().toISOString(),
        file_path: filePath,
        file_url: fileUrl,
        download_url: fileUrl,
        sales_overview: {
          ...salesOverview,
          currency: currencyCode,
        },
        order_statistics: orderStatistics,
        popular_items: popularItems,
      },
      message: 'Report exported successfully',
    });
  } catch (error) {
    console.error('Restaurant analytics export error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while exporting analytics report',
    });
  }
});

// ========== RESTAURANT OWNER CORE ENDPOINTS ==========

router.get('/dashboard', authenticateToken, authorizeRole(['restaurant_owner', 'admin']), async (req, res) => {
  try {
    const restaurant = await resolveManagedRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({
        status: 'fail',
        message: 'No restaurant profile found for this account. Please complete restaurant registration first.',
      });
    }

    const [
      totalOrders,
      totalRevenue,
      totalProducts,
      pendingOrders,
      processingOrders,
      completedOrders,
      cancelledOrders,
    ] = await Promise.all([
      prisma.order.count({
        where: {
          restaurantId: restaurant.id,
          deletedAt: null,
        },
      }),
      prisma.order.aggregate({
        where: {
          restaurantId: restaurant.id,
          status: { in: ['completed', 'delivered'] },
          paymentStatus: 'paid',
          deletedAt: null,
        },
        _sum: { totalAmount: true },
      }),
      prisma.product.count({
        where: {
          restaurantId: restaurant.id,
          deletedAt: null,
        },
      }),
      prisma.order.count({
        where: {
          restaurantId: restaurant.id,
          status: 'pending',
          deletedAt: null,
        },
      }),
      prisma.order.count({
        where: {
          restaurantId: restaurant.id,
          status: { in: ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery'] },
          deletedAt: null,
        },
      }),
      prisma.order.count({
        where: {
          restaurantId: restaurant.id,
          status: { in: ['completed', 'delivered'] },
          deletedAt: null,
        },
      }),
      prisma.order.count({
        where: {
          restaurantId: restaurant.id,
          status: 'cancelled',
          deletedAt: null,
        },
      }),
    ]);

    return res.status(200).json({
      status: 'success',
      data: {
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          status: restaurant.status,
        },
        summary: {
          totalOrders,
          totalRevenue: totalRevenue?._sum?.totalAmount || 0,
          totalProducts,
          pendingOrders,
          processingOrders,
          completedOrders,
          cancelledOrders,
        },
      },
    });
  } catch (error) {
    console.error('Restaurant dashboard error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching restaurant dashboard',
    });
  }
});

router.get('/profile', authenticateToken, authorizeRole(['restaurant_owner', 'admin']), async (req, res) => {
  try {
    const restaurant = await resolveManagedRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({
        status: 'fail',
        message: 'No restaurant profile found for this account. Please complete restaurant registration first.',
      });
    }

    const fullRestaurant = await prisma.restaurant.findUnique({
      where: { id: restaurant.id },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            email: true,
            fullName: true,
            phoneNumber: true,
          },
        },
      },
    });

    return res.status(200).json({
      status: 'success',
      data: fullRestaurant,
    });
  } catch (error) {
    console.error('Get restaurant profile error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching restaurant profile',
    });
  }
});

router.put('/profile', authenticateToken, authorizeRole(['restaurant_owner', 'admin']), async (req, res) => {
  try {
    const restaurant = await resolveManagedRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({
        status: 'fail',
        message: 'No restaurant profile found for this account. Please complete restaurant registration first.',
      });
    }

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
      commercialRegistryUrl,
      commercialRegisterPath,
      registrationDocumentUrl,
      operatingHours,
    } = req.body;

    const resolvedLogoUrl =
      logoUrl === undefined ? undefined : normalizeAssetUrl(logoUrl);
    const resolvedCoverImageUrl = resolveRestaurantCoverImageUrl({
      coverImageUrl,
      commercialRegistryUrl,
      commercialRegisterPath,
      registrationDocumentUrl,
    });

    const updatedRestaurant = await prisma.restaurant.update({
      where: { id: restaurant.id },
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
        ...(resolvedLogoUrl !== undefined && { logoUrl: resolvedLogoUrl }),
        ...(resolvedCoverImageUrl !== undefined && {
          coverImageUrl: resolvedCoverImageUrl,
        }),
        ...(operatingHours !== undefined && { operatingHours }),
        updatedBy: req.user.id,
        updatedAt: new Date(),
      },
    });

    return res.status(200).json({
      status: 'success',
      data: updatedRestaurant,
    });
  } catch (error) {
    console.error('Update restaurant profile error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while updating restaurant profile',
    });
  }
});

router.get('/products', authenticateToken, authorizeRole(['restaurant_owner', 'admin']), async (req, res) => {
  try {
    const restaurant = await resolveManagedRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({
        status: 'fail',
        message: 'No restaurant profile found for this account. Please complete restaurant registration first.',
      });
    }

    const { page = 1, limit = 20, search, categoryId } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const where = {
      restaurantId: restaurant.id,
      deletedAt: null,
      ...(categoryId ? { categoryId: categoryId.toString() } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search.toString(), mode: 'insensitive' } },
              { description: { contains: search.toString(), mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit, 10),
        skip,
      }),
      prisma.product.count({ where }),
    ]);

    return res.status(200).json({
      status: 'success',
      data: {
        products,
        pagination: {
          total,
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          pages: Math.ceil(total / parseInt(limit, 10)),
        },
      },
    });
  } catch (error) {
    console.error('Get restaurant products error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching restaurant products',
    });
  }
});

router.post('/products', authenticateToken, authorizeRole(['restaurant_owner', 'admin']), async (req, res) => {
  try {
    const restaurant = await resolveManagedRestaurant(req);
    if (!restaurant) {
      return res.status(409).json({
        status: 'fail',
        message: 'No restaurant profile found for this account. Please complete restaurant registration first.',
      });
    }

    const {
      name,
      description,
      price,
      imageUrl,
      categoryId,
      stockQuantity,
      preparationTimeMinutes,
      dietaryInfo,
    } = req.body;

    const parsedPrice = Number.parseFloat(price);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({
        status: 'fail',
        message: 'price must be a valid non-negative number',
      });
    }

    const product = await prisma.product.create({
      data: {
        name,
        description,
        price: parsedPrice,
        imageUrl,
        categoryId,
        itemType: 'restaurant_menu',
        restaurantId: restaurant.id,
        stockQuantity: stockQuantity || 0,
        preparationTimeMinutes,
        dietaryInfo,
        isAvailable: true,
        createdBy: req.user.id,
      },
    });

    return res.status(201).json({
      status: 'success',
      data: product,
    });
  } catch (error) {
    if (error?.code === 'P2003') {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid restaurant or category reference.',
      });
    }
    console.error('Create restaurant product error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while creating restaurant product',
    });
  }
});

router.get('/orders', authenticateToken, authorizeRole(['restaurant_owner', 'admin']), async (req, res) => {
  try {
    const restaurant = await resolveManagedRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({
        status: 'fail',
        message: 'No restaurant profile found for this account. Please complete restaurant registration first.',
      });
    }

    const { page = 1, limit = 20, status } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const where = {
      restaurantId: restaurant.id,
      deletedAt: null,
      ...(status ? { status: status.toString() } : {}),
    };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              phoneNumber: true,
            },
          },
          orderItems: {
            include: {
              product: {
                select: { id: true, name: true, imageUrl: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit, 10),
        skip,
      }),
      prisma.order.count({ where }),
    ]);

    return res.status(200).json({
      status: 'success',
      data: {
        orders,
        pagination: {
          total,
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          pages: Math.ceil(total / parseInt(limit, 10)),
        },
      },
    });
  } catch (error) {
    console.error('Get restaurant orders error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching restaurant orders',
    });
  }
});

router.put('/orders/:orderId/status', authenticateToken, authorizeRole(['restaurant_owner', 'admin']), async (req, res) => {
  try {
    const restaurant = await resolveManagedRestaurant(req);
    if (!restaurant) {
      return res.status(404).json({
        status: 'fail',
        message: 'No restaurant profile found for this account. Please complete restaurant registration first.',
      });
    }

    const { orderId } = req.params;
    const { status } = req.body;
    const cancellationReason = String(
      req.body?.reason || req.body?.notes || req.body?.cancellationReason || ''
    ).trim();
    const allowedStatuses = ['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'completed', 'cancelled'];
    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({
        status: 'fail',
        message: `Invalid status. Allowed values: ${allowedStatuses.join(', ')}`,
      });
    }

    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        restaurantId: restaurant.id,
        deletedAt: null,
      },
    });

    if (!order) {
      return res.status(404).json({
        status: 'fail',
        message: 'Order not found',
      });
    }

    const updatedOrder = await prisma.$transaction(async (tx) => {
      const nextOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status,
          updatedBy: req.user.id,
          updatedAt: new Date(),
        },
      });

      if (status === 'cancelled' && order.status !== 'cancelled') {
        const orderItems = await tx.orderItem.findMany({
          where: { orderId },
          select: {
            productId: true,
            quantity: true,
          },
        });

        for (const item of orderItems) {
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
              updatedBy: req.user.id,
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
              reason: 'order_cancelled_by_restaurant',
              actorUserId: req.user.id,
            },
          });
        }

        await tx.orderCancellationReason.upsert({
          where: { orderId },
          update: {
            reasonCode: 'restaurant_cancelled',
            reasonText: cancellationReason || null,
            cancelledByUserId: req.user.id,
            cancelledByRole: req.user.role,
            metadata: { source: 'restaurant.orders.status' },
          },
          create: {
            orderId,
            reasonCode: 'restaurant_cancelled',
            reasonText: cancellationReason || null,
            cancelledByUserId: req.user.id,
            cancelledByRole: req.user.role,
            metadata: { source: 'restaurant.orders.status' },
          },
        });
      }

      return nextOrder;
    });

    return res.status(200).json({
      status: 'success',
      data: updatedOrder,
    });
  } catch (error) {
    console.error('Update restaurant order status error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while updating order status',
    });
  }
});

// Get details of a specific restaurant
router.get('/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    if (!isValidUuid(restaurantId)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid restaurant id format',
      });
    }
    
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
      commercialRegistryUrl,
      commercialRegisterPath,
      registrationDocumentUrl,
      operatingHours
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        status: 'fail',
        message: 'name is required',
      });
    }
    if (!addressLine1 || !String(addressLine1).trim()) {
      return res.status(400).json({
        status: 'fail',
        message: 'addressLine1 is required',
      });
    }
    if (!city || !String(city).trim()) {
      return res.status(400).json({
        status: 'fail',
        message: 'city is required',
      });
    }
    if (!postalCode || !String(postalCode).trim()) {
      return res.status(400).json({
        status: 'fail',
        message: 'postalCode is required',
      });
    }

    const resolvedLogoUrl = normalizeAssetUrl(logoUrl);
    const resolvedCoverImageUrl = resolveRestaurantCoverImageUrl({
      coverImageUrl,
      commercialRegistryUrl,
      commercialRegisterPath,
      registrationDocumentUrl,
    });
    
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
        logoUrl: resolvedLogoUrl,
        ...(resolvedCoverImageUrl !== undefined && {
          coverImageUrl: resolvedCoverImageUrl,
        }),
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
      commercialRegistryUrl,
      commercialRegisterPath,
      registrationDocumentUrl,
      operatingHours
    } = req.body;

    const resolvedLogoUrl =
      logoUrl === undefined ? undefined : normalizeAssetUrl(logoUrl);
    const resolvedCoverImageUrl = resolveRestaurantCoverImageUrl({
      coverImageUrl,
      commercialRegistryUrl,
      commercialRegisterPath,
      registrationDocumentUrl,
    });
    
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

    const ownerResubmittedDocuments = req.user.role !== 'admin' &&
      restaurant.ownerId === req.user.id &&
      restaurant.status === 'rejected' &&
      (
        (typeof resolvedLogoUrl === 'string' && resolvedLogoUrl !== restaurant.logoUrl) ||
        (typeof resolvedCoverImageUrl === 'string' &&
          resolvedCoverImageUrl !== restaurant.coverImageUrl)
      );
    
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
        ...(resolvedLogoUrl !== undefined && { logoUrl: resolvedLogoUrl }),
        ...(resolvedCoverImageUrl !== undefined && {
          coverImageUrl: resolvedCoverImageUrl,
        }),
        ...(operatingHours !== undefined && { operatingHours }),
        ...(ownerResubmittedDocuments && {
          status: 'pending_approval',
          rejectionReason: null,
          rejectedAt: null,
        }),
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
    if (!isValidUuid(restaurantId)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid restaurant id format',
      });
    }
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
    if (!isValidUuid(restaurantId)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Invalid restaurant id format',
      });
    }
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
