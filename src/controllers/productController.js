const { createApiResponse } = require("../utils/responseHandler");
const enMessages = require("../config/messages/en.json");
const arMessages = require("../config/messages/ar.json");
const { Product, Bakery, Restaurant, Category, User } = require("../db/models");
const { Op } = require("sequelize");

// GET /products - List all available products (public)
exports.listProducts = async (req, res) => {
  try {
    // TODO: Add pagination, filtering (by category, bakery, restaurant, price range, rating), search by name_en/name_ar
    const { categoryId, bakeryId, restaurantId, searchTerm, minPrice, maxPrice, sortBy, order = 'ASC' } = req.query;
    let whereClause = { is_available: true };
    let includeClause = [
        { model: Category, as: "category", attributes: ["category_id", "name_en", "name_ar"] },
        { model: Bakery, as: "bakery", attributes: ["bakery_id", "name_en", "name_ar"] },
        { model: Restaurant, as: "restaurant", attributes: ["restaurant_id", "name_en", "name_ar"] }
    ];

    if (categoryId) whereClause.category_id = categoryId;
    if (bakeryId) whereClause.bakery_id = bakeryId;
    if (restaurantId) whereClause.restaurant_id = restaurantId;
    if (searchTerm) {
        whereClause[Op.or] = [
            { name_en: { [Op.iLike]: `%${searchTerm}%` } },
            { name_ar: { [Op.iLike]: `%${searchTerm}%` } },
            // { description_en: { [Op.iLike]: `%${searchTerm}%` } }, // Optional: search in description
            // { description_ar: { [Op.iLike]: `%${searchTerm}%` } }
        ];
    }
    if (minPrice) whereClause.price = { ...whereClause.price, [Op.gte]: parseFloat(minPrice) };
    if (maxPrice) whereClause.price = { ...whereClause.price, [Op.lte]: parseFloat(maxPrice) };

    let orderClause = [];
    if (sortBy) {
        if (sortBy === "price") orderClause.push(["price", order.toUpperCase()]);
        if (sortBy === "name") orderClause.push(["name_en", order.toUpperCase()]); // Or handle name_ar sorting
        if (sortBy === "rating") orderClause.push(["average_rating", order.toUpperCase()]);
    } else {
        orderClause.push(["createdAt", "DESC"]); // Default sort
    }

    const products = await Product.findAll({
      where: whereClause,
      include: includeClause,
      order: orderClause,
      attributes: {
        exclude: ["bakery_id", "restaurant_id", "category_id"] // Exclude redundant foreign keys from Product model itself
      }
    });

    return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, { products }, true));
  } catch (error) {
    console.error("List products error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// GET /products/:productId - Get details of a specific product (public)
exports.getProductDetails = async (req, res) => {
  try {
    const { productId } = req.params;
    const product = await Product.findOne({
      where: { product_id: productId, is_available: true },
      include: [
        { model: Category, as: "category", attributes: ["category_id", "name_en", "name_ar"] },
        { model: Bakery, as: "bakery", attributes: ["bakery_id", "name_en", "name_ar", "status"] },
        { model: Restaurant, as: "restaurant", attributes: ["restaurant_id", "name_en", "name_ar", "status"] },
        // TODO: Include reviews when Review model and controller are ready
      ],
      attributes: { exclude: ["bakery_id", "restaurant_id", "category_id"] }
    });

    if (!product) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Product not found or not available.", ar: "المنتج غير موجود أو غير متوفر."}}, false));
    }
    // Optionally, check if associated bakery/restaurant is approved if product is tied to one
    if (product.bakery && product.bakery.status !== "approved") {
        // Decide if product should still be shown or considered unavailable
    }
    if (product.restaurant && product.restaurant.status !== "approved") {
        // Decide if product should still be shown or considered unavailable
    }

    return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, { product }, true));
  } catch (error) {
    console.error("Get product details error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// POST /products - Add a new product (protected, bakery_owner, restaurant_owner, or admin)
exports.addProduct = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const userRole = req.user.role;

    const {
      bakery_id, restaurant_id, category_id,
      name_en, name_ar, description_en, description_ar,
      price, sku, stock_quantity, image_url, additional_images,
      is_available, nutritional_info_en, nutritional_info_ar, allergen_info_en, allergen_info_ar
    } = req.body;

    if (!name_en || !name_ar || !price) {
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
        [{ field: "name_en, name_ar, price", message: { en: "Required product fields are missing.", ar: "حقول المنتج المطلوبة مفقودة."}}]
      ));
    }

    // Authorization: Check if user owns the bakery/restaurant or is an admin
    if (bakery_id) {
        const bakery = await Bakery.findByPk(bakery_id);
        if (!bakery || (bakery.owner_id !== userId && userRole !== "admin")) {
            return res.status(403).json(createApiResponse(enMessages.FORBIDDEN, arMessages.FORBIDDEN, {detail: {en: "Not authorized to add product to this bakery.", ar: "غير مصرح لك بإضافة منتج لهذا المخبز."}}, false));
        }
    }
    if (restaurant_id) {
        const restaurant = await Restaurant.findByPk(restaurant_id);
        if (!restaurant || (restaurant.owner_id !== userId && userRole !== "admin")) {
            return res.status(403).json(createApiResponse(enMessages.FORBIDDEN, arMessages.FORBIDDEN, {detail: {en: "Not authorized to add product to this restaurant.", ar: "غير مصرح لك بإضافة منتج لهذا المطعم."}}, false));
        }
    }
    if (!bakery_id && !restaurant_id && userRole !== "admin") {
        return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, 
            [{ field: "bakery_id/restaurant_id", message: { en: "Product must be associated with a bakery or restaurant.", ar: "يجب ربط المنتج بمخبز أو مطعم."}}]
        ));
    }

    const newProduct = await Product.create({
      bakery_id, restaurant_id, category_id,
      name_en, name_ar, description_en, description_ar,
      price, sku, stock_quantity: stock_quantity === undefined ? null : stock_quantity, 
      image_url, additional_images,
      is_available: is_available === undefined ? true : is_available, 
      nutritional_info_en, nutritional_info_ar, allergen_info_en, allergen_info_ar
    });

    return res.status(201).json(createApiResponse(enMessages.CREATE_SUCCESS, arMessages.CREATE_SUCCESS, { product: newProduct }, true));

  } catch (error) {
    console.error("Add product error:", error);
    if (error.name === "SequelizeValidationError" || error.name === "SequelizeUniqueConstraintError") {
      const validationErrors = error.errors.map(err => ({ field: err.path, message: { en: err.message, ar: `خطأ في التحقق لحقل: ${err.path}` }}));
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, validationErrors));
    }
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// PUT /products/:productId - Update an existing product (protected, owner or admin)
exports.updateProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user.user_id;
    const userRole = req.user.role;

    const product = await Product.findByPk(productId, {
        include: [{model: Bakery, as: "bakery"}, {model: Restaurant, as: "restaurant"}]
    });
    if (!product) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Product not found.", ar: "المنتج غير موجود."}}, false));
    }

    // Authorization: Check if user owns the bakery/restaurant associated with the product or is an admin
    let isAuthorized = false;
    if (userRole === "admin") {
        isAuthorized = true;
    } else if (product.bakery && product.bakery.owner_id === userId) {
        isAuthorized = true;
    } else if (product.restaurant && product.restaurant.owner_id === userId) {
        isAuthorized = true;
    }

    if (!isAuthorized) {
        return res.status(403).json(createApiResponse(enMessages.FORBIDDEN, arMessages.FORBIDDEN, null, false));
    }

    const { /* Destructure all updatable fields */ 
        category_id,
        name_en, name_ar, description_en, description_ar,
        price, sku, stock_quantity, image_url, additional_images,
        is_available, nutritional_info_en, nutritional_info_ar, allergen_info_en, allergen_info_ar
    } = req.body;

    // Update fields selectively
    if (category_id !== undefined) product.category_id = category_id;
    if (name_en !== undefined) product.name_en = name_en;
    // ... update all other fields similarly
    product.name_ar = name_ar !== undefined ? name_ar : product.name_ar;
    product.description_en = description_en !== undefined ? description_en : product.description_en;
    product.description_ar = description_ar !== undefined ? description_ar : product.description_ar;
    product.price = price !== undefined ? price : product.price;
    product.sku = sku !== undefined ? sku : product.sku;
    product.stock_quantity = stock_quantity !== undefined ? stock_quantity : product.stock_quantity;
    product.image_url = image_url !== undefined ? image_url : product.image_url;
    product.additional_images = additional_images !== undefined ? additional_images : product.additional_images;
    product.is_available = is_available !== undefined ? is_available : product.is_available;
    product.nutritional_info_en = nutritional_info_en !== undefined ? nutritional_info_en : product.nutritional_info_en;
    product.nutritional_info_ar = nutritional_info_ar !== undefined ? nutritional_info_ar : product.nutritional_info_ar;
    product.allergen_info_en = allergen_info_en !== undefined ? allergen_info_en : product.allergen_info_en;
    product.allergen_info_ar = allergen_info_ar !== undefined ? allergen_info_ar : product.allergen_info_ar;

    await product.save();
    return res.status(200).json(createApiResponse(enMessages.UPDATE_SUCCESS, arMessages.UPDATE_SUCCESS, { product }, true));

  } catch (error) {
    console.error("Update product error:", error);
    if (error.name === "SequelizeValidationError" || error.name === "SequelizeUniqueConstraintError") {
      const validationErrors = error.errors.map(err => ({ field: err.path, message: { en: err.message, ar: `خطأ في التحقق لحقل: ${err.path}` }}));
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, validationErrors));
    }
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// DELETE /products/:productId - Delete a product (protected, owner or admin)
exports.deleteProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user.user_id;
    const userRole = req.user.role;

    const product = await Product.findByPk(productId, {
        include: [{model: Bakery, as: "bakery"}, {model: Restaurant, as: "restaurant"}]
    });
    if (!product) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Product not found.", ar: "المنتج غير موجود."}}, false));
    }

    let isAuthorized = false;
    if (userRole === "admin") {
        isAuthorized = true;
    } else if (product.bakery && product.bakery.owner_id === userId) {
        isAuthorized = true;
    } else if (product.restaurant && product.restaurant.owner_id === userId) {
        isAuthorized = true;
    }

    if (!isAuthorized) {
        return res.status(403).json(createApiResponse(enMessages.FORBIDDEN, arMessages.FORBIDDEN, null, false));
    }

    await product.destroy(); // Hard delete. Consider soft delete (paranoid: true in model)
    // TODO: Handle related data if not cascaded (e.g., cart items, order items with this product)

    return res.status(200).json(createApiResponse(enMessages.DELETE_SUCCESS, arMessages.DELETE_SUCCESS, null, true));

  } catch (error) {
    console.error("Delete product error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

