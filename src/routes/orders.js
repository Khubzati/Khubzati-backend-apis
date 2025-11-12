const express = require('express');
const { PrismaClient } = require('../generated/prisma');
const { authenticateToken } = require('../middleware/auth');

const prisma = new PrismaClient();
const router = express.Router();

// Create a new order
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      bakeryId,
      restaurantId,
      orderType,
      deliveryAddressId,
      items,
      paymentMethod,
      specialInstructions
    } = req.body;

    // Validate request
    if (!items || !items.length) {
      return res.status(400).json({
        status: 'fail',
        message: 'Order must contain at least one item'
      });
    }

    if (!orderType || !['pickup', 'delivery'].includes(orderType)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Valid order type (pickup or delivery) is required'
      });
    }

    if (orderType === 'delivery' && !deliveryAddressId) {
      return res.status(400).json({
        status: 'fail',
        message: 'Delivery address is required for delivery orders'
      });
    }

    // Validate that all products exist and are available
    const productIds = items.map(item => item.productId);
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        isAvailable: true,
        deletedAt: null
      }
    });

    if (products.length !== productIds.length) {
      return res.status(400).json({
        status: 'fail',
        message: 'One or more products are not available'
      });
    }

    // Calculate total amount
    let totalAmount = 0;
    const orderItems = [];

    for (const item of items) {
      const product = products.find(p => p.id === item.productId);
      const subtotal = parseFloat(product.price) * item.quantity;
      totalAmount += subtotal;

      orderItems.push({
        productId: item.productId,
        quantity: item.quantity,
        price: parseFloat(product.price),
        subtotal,
        specialInstructions: item.specialInstructions
      });
    }

    // Generate order number
    const orderNumber = `KHB-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Create order with items
    const order = await prisma.order.create({
      data: {
        userId: req.user.id,
        bakeryId,
        restaurantId,
        orderNumber,
        status: 'pending',
        orderType,
        deliveryAddressId: orderType === 'delivery' ? deliveryAddressId : null,
        totalAmount,
        paymentMethod,
        paymentStatus: 'pending',
        specialInstructions,
        createdBy: req.user.id,
        orderItems: {
          create: orderItems
        }
      },
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                name: true,
                imageUrl: true
              }
            }
          }
        },
        deliveryAddress: true
      }
    });

    // Create notification for the user
    await prisma.notification.create({
      data: {
        userId: req.user.id,
        title: 'Order Placed',
        message: `Your order #${orderNumber} has been placed successfully.`,
        type: 'order',
        relatedId: order.id,
        createdBy: 'system'
      }
    });

    return res.status(201).json({
      status: 'success',
      data: {
        order
      }
    });
  } catch (error) {
    console.error('Create order error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while creating order'
    });
  }
});

// Get all orders for current user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    
    const whereClause = {
      userId: req.user.id,
      deletedAt: null
    };
    
    if (status) {
      whereClause.status = status;
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [orders, totalCount] = await Promise.all([
      prisma.order.findMany({
        where: whereClause,
        include: {
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
      data: {
        orders,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(totalCount / parseInt(limit))
        }
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

// Get details of a specific order
router.get('/:orderId', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        userId: req.user.id,
        deletedAt: null
      },
      include: {
        bakery: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            addressLine1: true,
            city: true
          }
        },
        restaurant: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            addressLine1: true,
            city: true
          }
        },
        deliveryAddress: true,
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                imageUrl: true,
                description: true
              }
            }
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
      data: {
        order
      }
    });
  } catch (error) {
    console.error('Get order details error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while fetching order details'
    });
  }
});

// Update order status (Bakery/Restaurant Owner Role)
router.put('/:orderId/status', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    
    if (!status || !['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Valid status is required'
      });
    }
    
    // Find order
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        bakery: true,
        restaurant: true
      }
    });
    
    if (!order) {
      return res.status(404).json({
        status: 'fail',
        message: 'Order not found'
      });
    }
    
    // Check if user is authorized to update this order
    let isAuthorized = false;
    
    if (req.user.role === 'admin') {
      isAuthorized = true;
    } else if (req.user.role === 'bakery_owner' && order.bakeryId) {
      const bakery = await prisma.bakery.findFirst({
        where: {
          id: order.bakeryId,
          ownerId: req.user.id
        }
      });
      isAuthorized = !!bakery;
    } else if (req.user.role === 'restaurant_owner' && order.restaurantId) {
      const restaurant = await prisma.restaurant.findFirst({
        where: {
          id: order.restaurantId,
          ownerId: req.user.id
        }
      });
      isAuthorized = !!restaurant;
    } else if (req.user.id === order.userId && status === 'cancelled') {
      // Customers can only cancel their own orders
      isAuthorized = true;
    }
    
    if (!isAuthorized) {
      return res.status(403).json({
        status: 'fail',
        message: 'You do not have permission to update this order'
      });
    }
    
    // Update order status
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status,
        updatedBy: req.user.id,
        updatedAt: new Date()
      }
    });
    
    // Create notification for the user
    let notificationTitle, notificationMessage;
    
    switch (status) {
      case 'confirmed':
        notificationTitle = 'Order Confirmed';
        notificationMessage = `Your order #${order.orderNumber} has been confirmed.`;
        break;
      case 'preparing':
        notificationTitle = 'Order Preparation Started';
        notificationMessage = `Your order #${order.orderNumber} is now being prepared.`;
        break;
      case 'ready_for_pickup':
        notificationTitle = 'Order Ready for Pickup';
        notificationMessage = `Your order #${order.orderNumber} is ready for pickup.`;
        break;
      case 'out_for_delivery':
        notificationTitle = 'Order Out for Delivery';
        notificationMessage = `Your order #${order.orderNumber} is out for delivery.`;
        break;
      case 'delivered':
        notificationTitle = 'Order Delivered';
        notificationMessage = `Your order #${order.orderNumber} has been delivered.`;
        break;
      case 'completed':
        notificationTitle = 'Order Completed';
        notificationMessage = `Your order #${order.orderNumber} has been completed.`;
        break;
      case 'cancelled':
        notificationTitle = 'Order Cancelled';
        notificationMessage = `Your order #${order.orderNumber} has been cancelled.`;
        break;
    }
    
    await prisma.notification.create({
      data: {
        userId: order.userId,
        title: notificationTitle,
        message: notificationMessage,
        type: 'order',
        relatedId: order.id,
        createdBy: 'system'
      }
    });
    
    return res.status(200).json({
      status: 'success',
      data: {
        order: updatedOrder
      }
    });
  } catch (error) {
    console.error('Update order status error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while updating order status'
    });
  }
});

// Cancel an order (Customer Role)
router.post('/:orderId/cancel', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Find order
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        userId: req.user.id,
        deletedAt: null
      }
    });
    
    if (!order) {
      return res.status(404).json({
        status: 'fail',
        message: 'Order not found'
      });
    }
    
    // Check if order can be cancelled
    if (!['pending', 'confirmed'].includes(order.status)) {
      return res.status(400).json({
        status: 'fail',
        message: 'Only pending or confirmed orders can be cancelled'
      });
    }
    
    // Update order status
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'cancelled',
        updatedBy: req.user.id,
        updatedAt: new Date()
      }
    });
    
    // Create notification for the user
    await prisma.notification.create({
      data: {
        userId: req.user.id,
        title: 'Order Cancelled',
        message: `Your order #${order.orderNumber} has been cancelled.`,
        type: 'order',
        relatedId: order.id,
        createdBy: 'system'
      }
    });
    
    return res.status(200).json({
      status: 'success',
      data: {
        order: updatedOrder
      }
    });
  } catch (error) {
    console.error('Cancel order error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while cancelling order'
    });
  }
});

module.exports = router;
