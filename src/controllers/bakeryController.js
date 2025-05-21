const { createApiResponse } = require("../utils/responseHandler");
const enMessages = require("../config/messages/en.json");
const arMessages = require("../config/messages/ar.json");
const { Bakery, User } = require("../db/models");
const { Op } = require("sequelize"); // For search/filtering if needed

// GET /bakeries - List all approved bakeries (public)
exports.listBakeries = async (req, res) => {
  try {
    // TODO: Add pagination, filtering (by city, rating, etc.), and search
    const bakeries = await Bakery.findAll({
      where: { status: "approved" }, // Only show approved bakeries publicly
      include: [{ model: User, as: "owner", attributes: ["user_id", "username", "email"] }], // Include owner info selectively
      attributes: {
        exclude: ["owner_id"] // Exclude redundant owner_id from Bakery model itself
      }
    });

    return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, { bakeries }, true));
  } catch (error) {
    console.error("List bakeries error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// GET /bakeries/:bakeryId - Get details of a specific approved bakery (public)
exports.getBakeryDetails = async (req, res) => {
  try {
    const { bakeryId } = req.params;
    const bakery = await Bakery.findOne({
      where: { bakery_id: bakeryId, status: "approved" },
      include: [
        { model: User, as: "owner", attributes: ["user_id", "username", "email"] },
        // TODO: Include associated products, reviews when those models and controllers are ready
        // { model: Product, as: "products" }, 
        // { model: Review, as: "reviews" }
      ],
      attributes: {
        exclude: ["owner_id"]
      }
    });

    if (!bakery) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Bakery not found or not approved.", ar: "المخبز غير موجود أو غير معتمد."}}, false));
    }

    return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, { bakery }, true));
  } catch (error) {
    console.error("Get bakery details error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// POST /bakeries - Register a new bakery (protected, bakery_owner or admin)
exports.registerBakery = async (req, res) => {
  try {
    const owner_id = req.user.user_id; // From protect middleware
    const {
      name_en, name_ar, description_en, description_ar,
      profile_image_url, cover_image_url,
      address_line1, address_line2, city, state_province_region, postal_code, country,
      phone_number, email, operating_hours, latitude, longitude
    } = req.body;

    // Basic validation
    if (!name_en || !name_ar || !address_line1 || !city || !postal_code || !country) {
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, 
        [{ field: "name_en, name_ar, address, city, postal_code, country", message: { en: "Required bakery fields are missing.", ar: "حقول المخبز المطلوبة مفقودة."}}]
      ));
    }

    // Check if user already owns a bakery (optional rule, depends on business logic)
    // const existingBakery = await Bakery.findOne({ where: { owner_id } });
    // if (existingBakery) {
    //   return res.status(400).json(createApiResponse(enMessages.CREATE_ERROR, arMessages.CREATE_ERROR, 
    //     { detail: { en: "User already owns a bakery.", ar: "المستخدم يمتلك مخبزًا بالفعل." } }, false));
    // }

    const newBakery = await Bakery.create({
      owner_id,
      name_en, name_ar, description_en, description_ar,
      profile_image_url, cover_image_url,
      address_line1, address_line2, city, state_province_region, postal_code, country,
      phone_number, email, operating_hours, latitude, longitude,
      status: "pending_approval" // Default status
    });

    return res.status(201).json(createApiResponse(enMessages.CREATE_SUCCESS, arMessages.CREATE_SUCCESS, { bakery: newBakery }, true));

  } catch (error) {
    console.error("Register bakery error:", error);
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

// PUT /bakeries/:bakeryId - Update an existing bakery (protected, owner or admin)
exports.updateBakery = async (req, res) => {
  try {
    const { bakeryId } = req.params;
    const userId = req.user.user_id;
    const userRole = req.user.role;

    const bakery = await Bakery.findByPk(bakeryId);
    if (!bakery) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Bakery not found.", ar: "المخبز غير موجود."}}, false));
    }

    // Authorization: Only owner or admin can update
    if (bakery.owner_id !== userId && userRole !== "admin") {
      return res.status(403).json(createApiResponse(enMessages.FORBIDDEN, arMessages.FORBIDDEN, null, false));
    }

    const {
      name_en, name_ar, description_en, description_ar,
      profile_image_url, cover_image_url,
      address_line1, address_line2, city, state_province_region, postal_code, country,
      phone_number, email, operating_hours, latitude, longitude
      // status - should be updated by admin via a separate route
    } = req.body;

    // Update fields
    if (name_en !== undefined) bakery.name_en = name_en;
    if (name_ar !== undefined) bakery.name_ar = name_ar;
    if (description_en !== undefined) bakery.description_en = description_en;
    if (description_ar !== undefined) bakery.description_ar = description_ar;
    // ... update other fields similarly
    bakery.profile_image_url = profile_image_url !== undefined ? profile_image_url : bakery.profile_image_url;
    bakery.cover_image_url = cover_image_url !== undefined ? cover_image_url : bakery.cover_image_url;
    bakery.address_line1 = address_line1 !== undefined ? address_line1 : bakery.address_line1;
    bakery.address_line2 = address_line2 !== undefined ? address_line2 : bakery.address_line2;
    bakery.city = city !== undefined ? city : bakery.city;
    bakery.state_province_region = state_province_region !== undefined ? state_province_region : bakery.state_province_region;
    bakery.postal_code = postal_code !== undefined ? postal_code : bakery.postal_code;
    bakery.country = country !== undefined ? country : bakery.country;
    bakery.phone_number = phone_number !== undefined ? phone_number : bakery.phone_number;
    bakery.email = email !== undefined ? email : bakery.email;
    bakery.operating_hours = operating_hours !== undefined ? operating_hours : bakery.operating_hours;
    bakery.latitude = latitude !== undefined ? latitude : bakery.latitude;
    bakery.longitude = longitude !== undefined ? longitude : bakery.longitude;

    // If an admin is updating, they might change more fields or status, but status update is better via dedicated route.
    // If owner updates, status might revert to pending_approval if certain critical fields change.
    // For now, owner updates don't change status.

    await bakery.save();
    return res.status(200).json(createApiResponse(enMessages.UPDATE_SUCCESS, arMessages.UPDATE_SUCCESS, { bakery }, true));

  } catch (error) {
    console.error("Update bakery error:", error);
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

// PUT /admin/bakeries/:bakeryId/status - Admin approve/reject/suspend bakery
exports.approveRejectSuspendBakery = async (req, res) => {
  try {
    const { bakeryId } = req.params;
    const { status } = req.body; // Expected: "approved", "rejected", "suspended"

    if (!status || !["approved", "rejected", "suspended"].includes(status)) {
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
        [{ field: "status", message: { en: "Invalid status provided.", ar: "الحالة المقدمة غير صالحة."}}]
      ));
    }

    const bakery = await Bakery.findByPk(bakeryId);
    if (!bakery) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Bakery not found.", ar: "المخبز غير موجود."}}, false));
    }

    bakery.status = status;
    await bakery.save();

    // TODO: Send notification to bakery owner about status change

    return res.status(200).json(createApiResponse(enMessages.UPDATE_SUCCESS, arMessages.UPDATE_SUCCESS, { bakery }, true));

  } catch (error) {
    console.error("Update bakery status error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// DELETE /admin/bakeries/:bakeryId - Admin delete bakery (soft delete can be implemented in model)
exports.deleteBakery = async (req, res) => {
  try {
    const { bakeryId } = req.params;
    const bakery = await Bakery.findByPk(bakeryId);

    if (!bakery) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Bakery not found.", ar: "المخبز غير موجود."}}, false));
    }

    await bakery.destroy(); // This is a hard delete. For soft delete, add `paranoid: true` to model and `bakery.destroy()` will set `deletedAt`.
    
    // TODO: Handle related data (products, reviews) - cascade delete or disassociate based on business rules.

    return res.status(200).json(createApiResponse(enMessages.DELETE_SUCCESS, arMessages.DELETE_SUCCESS, null, true));

  } catch (error) {
    console.error("Delete bakery error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

