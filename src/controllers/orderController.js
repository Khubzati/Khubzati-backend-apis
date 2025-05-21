const { createApiResponse } = require("../utils/responseHandler");
const enMessages = require("../config/messages/en.json");
const arMessages = require("../config/messages/ar.json");
const { Order, OrderItem, Cart, CartItem, Product, User, Address, Bakery, Restaurant } = require("../db/models");
const { sequelize } = require("../db/models"); // For transactions
const { Op } = require("sequelize");

// POST /orders - Create a new order from the user's cart
exports.createOrder = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const userId = req.user.user_id;
    const { delivery_address_id, billing_address_id, payment_method, special_instructions } = req.body;

    if (!delivery_address_id && !req.body.pickup_option) { // Assuming pickup_option might mean no delivery_address_id
      await t.rollback();
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
        [{ field: "delivery_address_id", message: { en: "Delivery address is required unless it's a pickup order.", ar: "عنوان التسليم مطلوب ما لم يكن الطلب للاستلام."}}]
      ));
    }
    if (!payment_method) {
        await t.rollback();
        return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
          [{ field: "payment_method", message: { en: "Payment method is required.", ar: "طريقة الدفع مطلوبة."}}]
        ));
    }

    // Verify addresses belong to the user
    if (delivery_address_id) {
        const deliveryAddress = await Address.findOne({ where: { address_id: delivery_address_id, user_id: userId } });
        if (!deliveryAddress) {
            await t.rollback();
            return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
                [{ field: "delivery_address_id", message: { en: "Invalid delivery address.", ar: "عنوان التسليم غير صالح."}}]
            ));
        }
    }
    if (billing_address_id) {
        const billingAddress = await Address.findOne({ where: { address_id: billing_address_id, user_id: userId } });
        if (!billingAddress) {
            await t.rollback();
            return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
                [{ field: "billing_address_id", message: { en: "Invalid billing address.", ar: "عنوان الفوترة غير صالح."}}]
            ));
        }
    }

    const cart = await Cart.findOne({
      where: { user_id: userId },
      include: [
        {
          model: CartItem,
          as: "items",
          required: true, // Ensure cart has items
          include: [{ model: Product, as: "product" }],
        },
      ],
      transaction: t
    });

    if (!cart || !cart.items || cart.items.length === 0) {
      await t.rollback();
      return res.status(400).json(createApiResponse(enMessages.CART_EMPTY, arMessages.CART_EMPTY, { detail: { en: "Cannot create order from an empty cart.", ar: "لا يمكن إنشاء طلب من سلة فارغة."}}, false));
    }

    let sub_total = 0;
    let orderItemsData = [];
    let associatedBakeryId = null;
    let associatedRestaurantId = null;

    for (const item of cart.items) {
      if (!item.product || !item.product.is_available) {
        await t.rollback();
        return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
          [{ field: `product_${item.product_id}`, message: { en: `Product '${item.product.name_en}' is no longer available.`, ar: `المنتج '${item.product.name_ar}' لم يعد متوفرًا.`}}]
        ));
      }
      if (item.product.stock_quantity !== null && item.product.stock_quantity < item.quantity) {
        await t.rollback();
        return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
          [{ field: `product_${item.product_id}`, message: { en: `Insufficient stock for product '${item.product.name_en}'.`, ar: `مخزون غير كافٍ للمنتج '${item.product.name_ar}'.`}}]
        ));
      }
      
      // Determine if order is from a single bakery or restaurant
      if (item.product.bakery_id) {
          if (associatedBakeryId && associatedBakeryId !== item.product.bakery_id) {
              await t.rollback();
              return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, 
                [{ message: {en: "Cart contains items from multiple bakeries. Please create separate orders.", ar: "تحتوي السلة على عناصر من مخابز متعددة. يرجى إنشاء طلبات منفصلة."}}]));
          }
          if (associatedRestaurantId) { // Cannot mix bakery and restaurant items in one order
            await t.rollback();
            return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, 
              [{ message: {en: "Cart contains items from both bakeries and restaurants. Please create separate orders.", ar: "تحتوي السلة على عناصر من مخابز ومطاعم. يرجى إنشاء طلبات منفصلة."}}]));
          }
          associatedBakeryId = item.product.bakery_id;
      }
      if (item.product.restaurant_id) {
        if (associatedRestaurantId && associatedRestaurantId !== item.product.restaurant_id) {
            await t.rollback();
            return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, 
              [{ message: {en: "Cart contains items from multiple restaurants. Please create separate orders.", ar: "تحتوي السلة على عناصر من مطاعم متعددة. يرجى إنشاء طلبات منفصلة."}}]));
        }
        if (associatedBakeryId) { // Cannot mix bakery and restaurant items in one order
            await t.rollback();
            return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, 
              [{ message: {en: "Cart contains items from both bakeries and restaurants. Please create separate orders.", ar: "تحتوي السلة على عناصر من مخابز ومطاعم. يرجى إنشاء طلبات منفصلة."}}]));
        }
        associatedRestaurantId = item.product.restaurant_id;
      }

      const itemPrice = parseFloat(item.price_at_addition); // Use price at time of cart addition
      sub_total += itemPrice * item.quantity;
      orderItemsData.push({
        product_id: item.product_id,
        quantity: item.quantity,
        price_at_purchase: itemPrice,
      });
    }
    
    // TODO: Calculate delivery_fee, service_fee, discount_amount based on business logic
    const delivery_fee = 0.00; // Placeholder
    const service_fee = 0.00; // Placeholder
    const discount_amount = 0.00; // Placeholder
    const total_amount = sub_total + delivery_fee + service_fee - discount_amount;

    const newOrder = await Order.create({
      user_id: userId,
      bakery_id: associatedBakeryId,
      restaurant_id: associatedRestaurantId,
      delivery_address_id: delivery_address_id,
      billing_address_id: billing_address_id || delivery_address_id, // Default billing to delivery if not provided
      total_amount: total_amount.toFixed(2),
      sub_total: sub_total.toFixed(2),
      delivery_fee: delivery_fee.toFixed(2),
      service_fee: service_fee.toFixed(2),
      discount_amount: discount_amount.toFixed(2),
      payment_method: payment_method,
      payment_status: "pending", // Initial payment status
      order_status: "pending_confirmation",
      special_instructions: special_instructions,
    }, { transaction: t });

    // Create order items and update stock if applicable
    for (const itemData of orderItemsData) {
      await OrderItem.create({ ...itemData, order_id: newOrder.order_id }, { transaction: t });
      const product = await Product.findByPk(itemData.product_id, { transaction: t });
      if (product && product.stock_quantity !== null) {
        product.stock_quantity -= itemData.quantity;
        await product.save({ transaction: t });
      }
    }

    // Clear the cart
    await CartItem.destroy({ where: { cart_id: cart.cart_id }, transaction: t });

    await t.commit();

    // Fetch the full order details to return
    const fullOrder = await Order.findByPk(newOrder.order_id, {
        include: [
            { model: User, as: "customer", attributes: ["user_id", "username", "email"] },
            { model: Address, as: "deliveryAddress" },
            { model: Address, as: "billingAddress" },
            { model: Bakery, as: "bakery", attributes: ["bakery_id", "name_en", "name_ar"] },
            { model: Restaurant, as: "restaurant", attributes: ["restaurant_id", "name_en", "name_ar"] },
            { 
                model: OrderItem, 
                as: "items", 
                include: [{ model: Product, as: "product", attributes: ["product_id", "name_en", "name_ar", "image_url"] }]
            }
        ]
    });

    // TODO: Trigger payment processing if not COD
    // TODO: Send order confirmation notification

    return res.status(201).json(createApiResponse(enMessages.ORDER_CREATED, arMessages.ORDER_CREATED, { order: fullOrder }, true));
  } catch (error) {
    await t.rollback();
    console.error("Create order error:", error);
    if (error.name === "SequelizeValidationError") {
        const validationErrors = error.errors.map(err => ({ field: err.path, message: { en: err.message, ar: `خطأ في التحقق لحقل: ${err.path}` }}));
        return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, validationErrors));
    }
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// GET /orders - List orders (user sees their orders, admin/owner sees relevant orders)
exports.listOrders = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const userRole = req.user.role;
    // TODO: Add pagination and filtering (by status, date range, bakery/restaurant ID for owners)
    let whereClause = {};

    if (userRole === "customer") {
      whereClause.user_id = userId;
    } else if (userRole === "bakery_owner") {
      // Find bakeries owned by this user
      const bakeries = await Bakery.findAll({ where: { owner_id: userId }, attributes: ["bakery_id"] });
      const bakeryIds = bakeries.map(b => b.bakery_id);
      if (bakeryIds.length === 0) return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, { orders: [] }, true));
      whereClause.bakery_id = { [Op.in]: bakeryIds };
    } else if (userRole === "restaurant_owner") {
      const restaurants = await Restaurant.findAll({ where: { owner_id: userId }, attributes: ["restaurant_id"] });
      const restaurantIds = restaurants.map(r => r.restaurant_id);
      if (restaurantIds.length === 0) return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, { orders: [] }, true));
      whereClause.restaurant_id = { [Op.in]: restaurantIds };
    } // Admin sees all orders (no user_id filter unless specified in query)
    
    const orders = await Order.findAll({
      where: whereClause,
      include: [
        { model: User, as: "customer", attributes: ["user_id", "username"] },
        { model: Bakery, as: "bakery", attributes: ["bakery_id", "name_en", "name_ar"] },
        { model: Restaurant, as: "restaurant", attributes: ["restaurant_id", "name_en", "name_ar"] },
        // Minimal item details for list view
        { model: OrderItem, as: "items", attributes: ["order_item_id", "quantity", "price_at_purchase"], 
            include: [{model: Product, as: "product", attributes:["product_id", "name_en", "name_ar"]}] 
        }
      ],
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, { orders }, true));
  } catch (error) {
    console.error("List orders error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// GET /orders/:orderId - Get details of a specific order
exports.getOrderDetails = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const userRole = req.user.role;
    const { orderId } = req.params;

    const order = await Order.findByPk(orderId, {
      include: [
        { model: User, as: "customer", attributes: ["user_id", "username", "email", "phone_number"] },
        { model: Address, as: "deliveryAddress" },
        { model: Address, as: "billingAddress" },
        { model: Bakery, as: "bakery" },
        { model: Restaurant, as: "restaurant" },
        {
          model: OrderItem,
          as: "items",
          include: [{ model: Product, as: "product" }], // Full product details for order item
        },
        // TODO: Include Payment details when Payment model and controller are ready
      ],
    });

    if (!order) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Order not found.", ar: "الطلب غير موجود."}}, false));
    }

    // Authorization check
    if (userRole === "customer" && order.user_id !== userId) {
      return res.status(403).json(createApiResponse(enMessages.FORBIDDEN, arMessages.FORBIDDEN, null, false));
    }
    if (userRole === "bakery_owner" && (!order.bakery || order.bakery.owner_id !== userId)) {
        return res.status(403).json(createApiResponse(enMessages.FORBIDDEN, arMessages.FORBIDDEN, null, false));
    }
    if (userRole === "restaurant_owner" && (!order.restaurant || order.restaurant.owner_id !== userId)) {
        return res.status(403).json(createApiResponse(enMessages.FORBIDDEN, arMessages.FORBIDDEN, null, false));
    }
    // Admin can access any order

    return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, { order }, true));
  } catch (error) {
    console.error("Get order details error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// PUT /orders/:orderId/status - Update order status (owner/admin)
exports.updateOrderStatus = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const userRole = req.user.role;
    const { orderId } = req.params;
    const { status } = req.body; // e.g., "confirmed", "preparing", "out_for_delivery", "delivered", "cancelled"

    const validStatuses = ["pending_confirmation", "confirmed", "preparing", "ready_for_pickup", "out_for_delivery", "delivered", "cancelled", "failed_delivery"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
        [{ field: "status", message: { en: "Invalid order status provided.", ar: "حالة الطلب المقدمة غير صالحة."}}]
      ));
    }

    const order = await Order.findByPk(orderId, { include: ["bakery", "restaurant"] });
    if (!order) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Order not found.", ar: "الطلب غير موجود."}}, false));
    }

    // Authorization: Admin, or owner of the associated bakery/restaurant
    let isAuthorized = false;
    if (userRole === "admin") {
        isAuthorized = true;
    } else if (userRole === "bakery_owner" && order.bakery && order.bakery.owner_id === userId) {
        isAuthorized = true;
    } else if (userRole === "restaurant_owner" && order.restaurant && order.restaurant.owner_id === userId) {
        isAuthorized = true;
    }

    if (!isAuthorized) {
        return res.status(403).json(createApiResponse(enMessages.FORBIDDEN, arMessages.FORBIDDEN, null, false));
    }

    // TODO: Add logic for status transitions (e.g., cannot go from 'delivered' back to 'preparing')
    order.order_status = status;
    if (status === "delivered" && !order.actual_delivery_time) {
        order.actual_delivery_time = new Date();
    }
    await order.save();

    // TODO: Send notification to customer about order status update

    return res.status(200).json(createApiResponse(enMessages.ORDER_STATUS_UPDATED, arMessages.ORDER_STATUS_UPDATED, { order }, true));
  } catch (error) {
    console.error("Update order status error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// POST /orders/:orderId/cancel - Cancel an order (user, if allowed, or admin/owner)
exports.cancelOrder = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const userId = req.user.user_id;
    const userRole = req.user.role;
    const { orderId } = req.params;

    const order = await Order.findByPk(orderId, { 
        include: ["bakery", "restaurant", {model: OrderItem, as: "items"}],
        transaction: t 
    });

    if (!order) {
      await t.rollback();
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Order not found.", ar: "الطلب غير موجود."}}, false));
    }

    // Authorization: User who placed the order, admin, or owner of associated bakery/restaurant
    let canCancel = false;
    if (userRole === "admin") {
        canCancel = true;
    } else if (order.user_id === userId) {
        // TODO: Add business logic for when a customer can cancel (e.g., only if status is 'pending_confirmation')
        if (["pending_confirmation", "confirmed"].includes(order.order_status)) {
            canCancel = true;
        }
    } else if (userRole === "bakery_owner" && order.bakery && order.bakery.owner_id === userId) {
        canCancel = true;
    } else if (userRole === "restaurant_owner" && order.restaurant && order.restaurant.owner_id === userId) {
        canCancel = true;
    }

    if (!canCancel) {
      await t.rollback();
      return res.status(403).json(createApiResponse(enMessages.FORBIDDEN, arMessages.FORBIDDEN, { detail: { en: "You are not authorized to cancel this order or it cannot be cancelled at this stage.", ar: "غير مصرح لك بإلغاء هذا الطلب أو لا يمكن إلغاؤه في هذه المرحلة."}}, false));
    }

    if (order.order_status === "cancelled" || order.order_status === "delivered") {
        await t.rollback();
        return res.status(400).json(createApiResponse(enMessages.ACTION_NOT_ALLOWED, arMessages.ACTION_NOT_ALLOWED, { detail: { en: `Order is already ${order.order_status}.`, ar: `الطلب بالفعل ${order.order_status}.`}}, false));
    }

    order.order_status = "cancelled";
    await order.save({ transaction: t });

    // Restore stock for cancelled order items
    for (const item of order.items) {
        const product = await Product.findByPk(item.product_id, { transaction: t });
        if (product && product.stock_quantity !== null) {
            product.stock_quantity += item.quantity;
            await product.save({ transaction: t });
        }
    }
    
    // TODO: Handle payment refund if already paid
    // TODO: Send notification about cancellation

    await t.commit();
    return res.status(200).json(createApiResponse(enMessages.ORDER_CANCELLED, arMessages.ORDER_CANCELLED, { order }, true));
  } catch (error) {
    await t.rollback();
    console.error("Cancel order error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// TODO: Implement payment processing endpoint (e.g., POST /orders/:orderId/payments)
// This would typically involve integrating with a payment gateway.

