const { createApiResponse } = require("../utils/responseHandler");
const enMessages = require("../config/messages/en.json");
const arMessages = require("../config/messages/ar.json");
const { Restaurant, User } = require("../db/models");

// GET /restaurants - List all approved restaurants (public)
exports.listRestaurants = async (req, res) => {
  try {
    // TODO: Add pagination, filtering (by city, cuisine, rating, etc.), and search
    const restaurants = await Restaurant.findAll({
      where: { status: "approved" },
      include: [{ model: User, as: "owner", attributes: ["user_id", "username", "email"] }],
      attributes: { exclude: ["owner_id"] }
    });
    return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, { restaurants }, true));
  } catch (error) {
    console.error("List restaurants error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// GET /restaurants/:restaurantId - Get details of a specific approved restaurant (public)
exports.getRestaurantDetails = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const restaurant = await Restaurant.findOne({
      where: { restaurant_id: restaurantId, status: "approved" },
      include: [
        { model: User, as: "owner", attributes: ["user_id", "username", "email"] },
        // TODO: Include associated products/menu items, reviews when models/controllers are ready
      ],
      attributes: { exclude: ["owner_id"] }
    });

    if (!restaurant) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Restaurant not found or not approved.", ar: "المطعم غير موجود أو غير معتمد."}}, false));
    }
    return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, { restaurant }, true));
  } catch (error) {
    console.error("Get restaurant details error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// POST /restaurants - Register a new restaurant (protected, restaurant_owner or admin)
exports.registerRestaurant = async (req, res) => {
  try {
    const owner_id = req.user.user_id;
    const {
      name_en, name_ar, description_en, description_ar, cuisine_type_en, cuisine_type_ar,
      profile_image_url, cover_image_url,
      address_line1, address_line2, city, state_province_region, postal_code, country,
      phone_number, email, operating_hours, latitude, longitude,
      table_booking_available, delivery_available, pickup_available
    } = req.body;

    if (!name_en || !name_ar || !address_line1 || !city || !postal_code || !country) {
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
        [{ field: "name_en, name_ar, address, city, postal_code, country", message: { en: "Required restaurant fields are missing.", ar: "حقول المطعم المطلوبة مفقودة."}}]
      ));
    }

    const newRestaurant = await Restaurant.create({
      owner_id,
      name_en, name_ar, description_en, description_ar, cuisine_type_en, cuisine_type_ar,
      profile_image_url, cover_image_url,
      address_line1, address_line2, city, state_province_region, postal_code, country,
      phone_number, email, operating_hours, latitude, longitude,
      table_booking_available, delivery_available, pickup_available,
      status: "pending_approval"
    });

    return res.status(201).json(createApiResponse(enMessages.CREATE_SUCCESS, arMessages.CREATE_SUCCESS, { restaurant: newRestaurant }, true));
  } catch (error) {
    console.error("Register restaurant error:", error);
    if (error.name === "SequelizeValidationError" || error.name === "SequelizeUniqueConstraintError") {
      const validationErrors = error.errors.map(err => ({ field: err.path, message: { en: err.message, ar: `خطأ في التحقق لحقل: ${err.path}` }}));
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, validationErrors));
    }
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// PUT /restaurants/:restaurantId - Update an existing restaurant (protected, owner or admin)
exports.updateRestaurant = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const userId = req.user.user_id;
    const userRole = req.user.role;

    const restaurant = await Restaurant.findByPk(restaurantId);
    if (!restaurant) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Restaurant not found.", ar: "المطعم غير موجود."}}, false));
    }

    if (restaurant.owner_id !== userId && userRole !== "admin") {
      return res.status(403).json(createApiResponse(enMessages.FORBIDDEN, arMessages.FORBIDDEN, null, false));
    }

    const { /* Destructure all updatable fields from req.body */ 
        name_en, name_ar, description_en, description_ar, cuisine_type_en, cuisine_type_ar,
        profile_image_url, cover_image_url,
        address_line1, address_line2, city, state_province_region, postal_code, country,
        phone_number, email, operating_hours, latitude, longitude,
        table_booking_available, delivery_available, pickup_available
    } = req.body;

    // Update fields selectively
    if (name_en !== undefined) restaurant.name_en = name_en;
    if (name_ar !== undefined) restaurant.name_ar = name_ar;
    // ... update all other fields similarly
    restaurant.description_en = description_en !== undefined ? description_en : restaurant.description_en;
    restaurant.description_ar = description_ar !== undefined ? description_ar : restaurant.description_ar;
    restaurant.cuisine_type_en = cuisine_type_en !== undefined ? cuisine_type_en : restaurant.cuisine_type_en;
    restaurant.cuisine_type_ar = cuisine_type_ar !== undefined ? cuisine_type_ar : restaurant.cuisine_type_ar;
    restaurant.profile_image_url = profile_image_url !== undefined ? profile_image_url : restaurant.profile_image_url;
    restaurant.cover_image_url = cover_image_url !== undefined ? cover_image_url : restaurant.cover_image_url;
    restaurant.address_line1 = address_line1 !== undefined ? address_line1 : restaurant.address_line1;
    restaurant.address_line2 = address_line2 !== undefined ? address_line2 : restaurant.address_line2;
    restaurant.city = city !== undefined ? city : restaurant.city;
    restaurant.state_province_region = state_province_region !== undefined ? state_province_region : restaurant.state_province_region;
    restaurant.postal_code = postal_code !== undefined ? postal_code : restaurant.postal_code;
    restaurant.country = country !== undefined ? country : restaurant.country;
    restaurant.phone_number = phone_number !== undefined ? phone_number : restaurant.phone_number;
    restaurant.email = email !== undefined ? email : restaurant.email;
    restaurant.operating_hours = operating_hours !== undefined ? operating_hours : restaurant.operating_hours;
    restaurant.latitude = latitude !== undefined ? latitude : restaurant.latitude;
    restaurant.longitude = longitude !== undefined ? longitude : restaurant.longitude;
    restaurant.table_booking_available = table_booking_available !== undefined ? table_booking_available : restaurant.table_booking_available;
    restaurant.delivery_available = delivery_available !== undefined ? delivery_available : restaurant.delivery_available;
    restaurant.pickup_available = pickup_available !== undefined ? pickup_available : restaurant.pickup_available;

    await restaurant.save();
    return res.status(200).json(createApiResponse(enMessages.UPDATE_SUCCESS, arMessages.UPDATE_SUCCESS, { restaurant }, true));
  } catch (error) {
    console.error("Update restaurant error:", error);
    if (error.name === "SequelizeValidationError" || error.name === "SequelizeUniqueConstraintError") {
      const validationErrors = error.errors.map(err => ({ field: err.path, message: { en: err.message, ar: `خطأ في التحقق لحقل: ${err.path}` }}));
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, validationErrors));
    }
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// PUT /admin/restaurants/:restaurantId/status - Admin approve/reject/suspend restaurant
exports.approveRejectSuspendRestaurant = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { status } = req.body; // Expected: "approved", "rejected", "suspended"

    if (!status || !["approved", "rejected", "suspended"].includes(status)) {
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
        [{ field: "status", message: { en: "Invalid status provided.", ar: "الحالة المقدمة غير صالحة."}}]
      ));
    }

    const restaurant = await Restaurant.findByPk(restaurantId);
    if (!restaurant) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Restaurant not found.", ar: "المطعم غير موجود."}}, false));
    }

    restaurant.status = status;
    await restaurant.save();
    // TODO: Send notification to restaurant owner

    return res.status(200).json(createApiResponse(enMessages.UPDATE_SUCCESS, arMessages.UPDATE_SUCCESS, { restaurant }, true));
  } catch (error) {
    console.error("Update restaurant status error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// DELETE /admin/restaurants/:restaurantId - Admin delete restaurant
exports.deleteRestaurant = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const restaurant = await Restaurant.findByPk(restaurantId);

    if (!restaurant) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Restaurant not found.", ar: "المطعم غير موجود."}}, false));
    }

    await restaurant.destroy();
    // TODO: Handle related data (menu items, reviews, orders)

    return res.status(200).json(createApiResponse(enMessages.DELETE_SUCCESS, arMessages.DELETE_SUCCESS, null, true));
  } catch (error) {
    console.error("Delete restaurant error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

