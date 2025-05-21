const { createApiResponse } = require("../utils/responseHandler");
const enMessages = require("../config/messages/en.json");
const arMessages = require("../config/messages/ar.json");
const { User, Address } = require("../db/models");

// GET /users/me - Get current logged-in user's profile
exports.getCurrentUserProfile = async (req, res) => {
  try {
    // req.user is attached by the 'protect' middleware
    if (!req.user) {
      // This case should ideally be caught by protect middleware, but as a safeguard:
      return res.status(401).json(createApiResponse(enMessages.UNAUTHORIZED, arMessages.UNAUTHORIZED, null, false));
    }
    // User data (excluding password_hash) is already on req.user
    return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, { user: req.user }, true));
  } catch (error) {
    console.error("Get profile error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// PUT /users/me - Update current logged-in user's profile
exports.updateCurrentUserProfile = async (req, res) => {
  try {
    const { full_name, phone_number, profile_picture_url } = req.body;
    const userId = req.user.user_id;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "User not found.", ar: "المستخدم غير موجود."}}, false));
    }

    // Update allowed fields
    if (full_name !== undefined) user.full_name = full_name;
    if (phone_number !== undefined) user.phone_number = phone_number;
    if (profile_picture_url !== undefined) user.profile_picture_url = profile_picture_url;

    await user.save();

    const userResponse = user.toJSON();
    delete userResponse.password_hash;

    return res.status(200).json(createApiResponse(enMessages.UPDATE_SUCCESS, arMessages.UPDATE_SUCCESS, { user: userResponse }, true));
  } catch (error) {
    console.error("Update profile error:", error);
    if (error.name === "SequelizeValidationError" || error.name === "SequelizeUniqueConstraintError") {
      const validationErrors = error.errors.map(err => ({
        field: err.path,
        message: { en: err.message, ar: `خطأ في التحقق لحقل: ${err.path}` }
      }));
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, validationErrors));
    }
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// GET /users/me/addresses - Get all addresses for the current user
exports.getUserAddresses = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const addresses = await Address.findAll({ where: { user_id: userId } });
    return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, { addresses }, true));
  } catch (error) {
    console.error("Get addresses error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// POST /users/me/addresses - Add a new address for the current user
exports.addUserAddress = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { address_line1, address_line2, city, state_province_region, postal_code, country, address_type, is_default, latitude, longitude } = req.body;

    if (!address_line1 || !city || !postal_code || !country) {
        return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, 
            [{ field: "address_line1, city, postal_code, country", message: { en: "Required address fields are missing.", ar: "حقول العنوان المطلوبة مفقودة."}}]
        ));
    }

    const newAddress = await Address.create({
      user_id: userId,
      address_line1,
      address_line2,
      city,
      state_province_region,
      postal_code,
      country,
      address_type,
      is_default,
      latitude,
      longitude
    });

    return res.status(201).json(createApiResponse(enMessages.CREATE_SUCCESS, arMessages.CREATE_SUCCESS, { address: newAddress }, true));
  } catch (error) {
    console.error("Add address error:", error);
    if (error.name === "SequelizeValidationError") {
      const validationErrors = error.errors.map(err => ({
        field: err.path,
        message: { en: err.message, ar: `خطأ في التحقق لحقل: ${err.path}` }
      }));
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, validationErrors));
    }
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// PUT /users/me/addresses/:addressId - Update an existing address
exports.updateUserAddress = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { addressId } = req.params;
    const { address_line1, address_line2, city, state_province_region, postal_code, country, address_type, is_default, latitude, longitude } = req.body;

    const address = await Address.findOne({ where: { address_id: addressId, user_id: userId } });

    if (!address) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Address not found or access denied.", ar: "العنوان غير موجود أو الوصول مرفوض."}}, false));
    }

    // Update fields
    if (address_line1 !== undefined) address.address_line1 = address_line1;
    if (address_line2 !== undefined) address.address_line2 = address_line2;
    if (city !== undefined) address.city = city;
    if (state_province_region !== undefined) address.state_province_region = state_province_region;
    if (postal_code !== undefined) address.postal_code = postal_code;
    if (country !== undefined) address.country = country;
    if (address_type !== undefined) address.address_type = address_type;
    if (is_default !== undefined) address.is_default = is_default;
    if (latitude !== undefined) address.latitude = latitude;
    if (longitude !== undefined) address.longitude = longitude;

    await address.save();
    return res.status(200).json(createApiResponse(enMessages.UPDATE_SUCCESS, arMessages.UPDATE_SUCCESS, { address }, true));
  } catch (error) {
    console.error("Update address error:", error);
     if (error.name === "SequelizeValidationError") {
      const validationErrors = error.errors.map(err => ({
        field: err.path,
        message: { en: err.message, ar: `خطأ في التحقق لحقل: ${err.path}` }
      }));
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, validationErrors));
    }
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// DELETE /users/me/addresses/:addressId - Delete an address
exports.deleteUserAddress = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { addressId } = req.params;

    const address = await Address.findOne({ where: { address_id: addressId, user_id: userId } });

    if (!address) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Address not found or access denied.", ar: "العنوان غير موجود أو الوصول مرفوض."}}, false));
    }

    await address.destroy();
    return res.status(200).json(createApiResponse(enMessages.DELETE_SUCCESS, arMessages.DELETE_SUCCESS, null, true));
  } catch (error) {
    console.error("Delete address error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

