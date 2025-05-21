const { createApiResponse } = require("../utils/responseHandler");
const enMessages = require("../config/messages/en.json");
const arMessages = require("../config/messages/ar.json");
const { User, Bakery, Restaurant, Order, Product } = require("../db/models");
const { Op } = require("sequelize");

// GET /admin/users - List all users (admin only)
exports.listUsers = async (req, res) => {
  try {
    // TODO: Add pagination, filtering (by role, status), search
    const { role, status, searchTerm, limit = 20, offset = 0 } = req.query;
    let whereClause = {};
    if (role) whereClause.role = role;
    if (status) whereClause.status = status; // Assuming User model has a status field (e.g., active, suspended, pending_verification)
    if (searchTerm) {
        whereClause[Op.or] = [
            { username: { [Op.iLike]: `%${searchTerm}%` } },
            { email: { [Op.iLike]: `%${searchTerm}%` } },
            { phone_number: { [Op.iLike]: `%${searchTerm}%` } }
        ];
    }

    const users = await User.findAndCountAll({
      where: whereClause,
      attributes: { exclude: ["password", "password_reset_token", "password_reset_expires"] }, // Exclude sensitive info
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, 
        { 
            users: users.rows,
            totalCount: users.count,
            currentPage: Math.floor(offset / limit) + 1,
            totalPages: Math.ceil(users.count / limit)
        }, 
        true
    ));
  } catch (error) {
    console.error("Admin list users error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// GET /admin/users/:userId - Get details of a specific user (admin only)
exports.getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findByPk(userId, {
      attributes: { exclude: ["password", "password_reset_token", "password_reset_expires"] },
      // Include related data if needed, e.g., addresses, orders (limit for performance)
      // include: [{ model: Address, as: "addresses"}, {model: Order, as: "orders", limit: 5}]
    });

    if (!user) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "User not found.", ar: "المستخدم غير موجود."}}, false));
    }
    return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, { user }, true));
  } catch (error) {
    console.error("Admin get user details error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// PUT /admin/users/:userId/status - Update user status (e.g., verify, suspend, activate) (admin only)
exports.updateUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, role } = req.body; // e.g., status: "active", "suspended", "verified"; role: "customer", "admin", etc.

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "User not found.", ar: "المستخدم غير موجود."}}, false));
    }

    if (status) {
        // Add validation for allowed statuses if User model has an ENUM for status
        // const validStatuses = ["active", "suspended", "pending_verification", "verified"];
        // if (!validStatuses.includes(status)) { ... error ... }
        user.status = status;
        if (status === "verified" && user.email_verified_at === null) {
            user.email_verified_at = new Date(); // Mark email as verified if status is set to verified
        }
    }
    if (role) {
        // Add validation for allowed roles
        const validRoles = ["customer", "admin", "bakery_owner", "restaurant_owner", "driver"];
        if (!validRoles.includes(role)) {
            return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, 
                [{field: "role", message: {en: "Invalid user role.", ar: "دور المستخدم غير صالح."}}]));
        }
        user.role = role;
    }

    await user.save();
    // Exclude password before sending back
    const userResponse = user.toJSON();
    delete userResponse.password;
    delete userResponse.password_reset_token;
    delete userResponse.password_reset_expires;

    return res.status(200).json(createApiResponse(enMessages.USER_STATUS_UPDATED, arMessages.USER_STATUS_UPDATED, { user: userResponse }, true));
  } catch (error) {
    console.error("Admin update user status error:", error);
    if (error.name === "SequelizeValidationError") {
        const validationErrors = error.errors.map(err => ({ field: err.path, message: { en: err.message, ar: `خطأ في التحقق لحقل: ${err.path}` }}));
        return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, validationErrors));
    }
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// Bakery approval is already in bakeryController (approveRejectSuspendBakery)
// Restaurant approval is already in restaurantController (approveRejectSuspendRestaurant)

// GET /admin/dashboard-summary - Example: Get some summary data for admin dashboard
exports.getDashboardSummary = async (req, res) => {
    try {
        const totalUsers = await User.count();
        const totalProducts = await Product.count();
        const totalOrders = await Order.count();
        const pendingBakeries = await Bakery.count({ where: { status: "pending_approval" } });
        const pendingRestaurants = await Restaurant.count({ where: { status: "pending_approval" } });
        // More stats can be added: total revenue (requires payment tracking), new users today, etc.

        const summary = {
            totalUsers: { en: `Total Users: ${totalUsers}`, ar: `إجمالي المستخدمين: ${totalUsers}`, value: totalUsers },
            totalProducts: { en: `Total Products: ${totalProducts}`, ar: `إجمالي المنتجات: ${totalProducts}`, value: totalProducts },
            totalOrders: { en: `Total Orders: ${totalOrders}`, ar: `إجمالي الطلبات: ${totalOrders}`, value: totalOrders },
            pendingBakeries: { en: `Bakeries Pending Approval: ${pendingBakeries}`, ar: `مخابز تنتظر الموافقة: ${pendingBakeries}`, value: pendingBakeries },
            pendingRestaurants: { en: `Restaurants Pending Approval: ${pendingRestaurants}`, ar: `مطاعم تنتظر الموافقة: ${pendingRestaurants}`, value: pendingRestaurants },
        };

        return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, { summary }, true));
    } catch (error) {
        console.error("Admin dashboard summary error:", error);
        return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
    }
};

// Placeholder for site settings if needed
// exports.getSiteSettings = async (req, res) => { ... };
// exports.updateSiteSettings = async (req, res) => { ... };

