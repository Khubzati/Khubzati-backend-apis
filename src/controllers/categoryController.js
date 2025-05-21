const { createApiResponse } = require("../utils/responseHandler");
const enMessages = require("../config/messages/en.json");
const arMessages = require("../config/messages/ar.json");
const { Category, Product } = require("../db/models");
const { Op } = require("sequelize");

// GET /categories - List all categories (public)
exports.listCategories = async (req, res) => {
  try {
    // TODO: Add filtering (e.g., by parent_category_id to get subcategories)
    const categories = await Category.findAll({
      include: [
        { model: Category, as: "subCategories", attributes: ["category_id", "name_en", "name_ar"] },
        // Optionally include parent category details if needed
        // { model: Category, as: "parentCategory", attributes: ["category_id", "name_en", "name_ar"] }
      ],
      // To get only top-level categories, add: where: { parent_category_id: null }
    });
    return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, { categories }, true));
  } catch (error) {
    console.error("List categories error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// GET /categories/:categoryId - Get details of a specific category (public)
exports.getCategoryDetails = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const category = await Category.findByPk(categoryId, {
      include: [
        { model: Category, as: "subCategories", attributes: ["category_id", "name_en", "name_ar"] },
        { model: Category, as: "parentCategory", attributes: ["category_id", "name_en", "name_ar"] },
        // TODO: Optionally include products in this category
        // { model: Product, as: "products", limit: 10, attributes: ["product_id", "name_en", "name_ar", "price", "image_url"] }
      ]
    });

    if (!category) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Category not found.", ar: "الفئة غير موجودة."}}, false));
    }
    return res.status(200).json(createApiResponse(enMessages.FETCH_SUCCESS, arMessages.FETCH_SUCCESS, { category }, true));
  } catch (error) {
    console.error("Get category details error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// POST /categories - Create a new category (admin only)
exports.createCategory = async (req, res) => {
  try {
    const { name_en, name_ar, description_en, description_ar, image_url, parent_category_id } = req.body;

    if (!name_en || !name_ar) {
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
        [{ field: "name_en, name_ar", message: { en: "Category name in both languages is required.", ar: "اسم الفئة باللغتين مطلوب."}}]
      ));
    }

    // Check if parent_category_id is valid if provided
    if (parent_category_id) {
        const parentCategory = await Category.findByPk(parent_category_id);
        if (!parentCategory) {
            return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
                [{ field: "parent_category_id", message: { en: "Parent category not found.", ar: "الفئة الأصلية غير موجودة."}}]
            ));
        }
    }

    const newCategory = await Category.create({
      name_en, name_ar, description_en, description_ar, image_url, parent_category_id
    });

    return res.status(201).json(createApiResponse(enMessages.CREATE_SUCCESS, arMessages.CREATE_SUCCESS, { category: newCategory }, true));
  } catch (error) {
    console.error("Create category error:", error);
    if (error.name === "SequelizeValidationError" || error.name === "SequelizeUniqueConstraintError") {
      const validationErrors = error.errors.map(err => ({ field: err.path, message: { en: err.message, ar: `خطأ في التحقق لحقل: ${err.path}` }}));
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, validationErrors));
    }
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// PUT /categories/:categoryId - Update an existing category (admin only)
exports.updateCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { name_en, name_ar, description_en, description_ar, image_url, parent_category_id } = req.body;

    const category = await Category.findByPk(categoryId);
    if (!category) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Category not found.", ar: "الفئة غير موجودة."}}, false));
    }

    // Check if parent_category_id is valid if provided and different from current categoryId
    if (parent_category_id && parent_category_id !== category.category_id) {
        const parentCategory = await Category.findByPk(parent_category_id);
        if (!parentCategory) {
            return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false,
                [{ field: "parent_category_id", message: { en: "Parent category not found.", ar: "الفئة الأصلية غير موجودة."}}]
            ));
        }
        category.parent_category_id = parent_category_id;
    } else if (parent_category_id === null) { // Allow setting parent to null
        category.parent_category_id = null;
    }

    if (name_en !== undefined) category.name_en = name_en;
    if (name_ar !== undefined) category.name_ar = name_ar;
    if (description_en !== undefined) category.description_en = description_en;
    if (description_ar !== undefined) category.description_ar = description_ar;
    if (image_url !== undefined) category.image_url = image_url;

    await category.save();
    return res.status(200).json(createApiResponse(enMessages.UPDATE_SUCCESS, arMessages.UPDATE_SUCCESS, { category }, true));
  } catch (error) {
    console.error("Update category error:", error);
    if (error.name === "SequelizeValidationError" || error.name === "SequelizeUniqueConstraintError") {
      const validationErrors = error.errors.map(err => ({ field: err.path, message: { en: err.message, ar: `خطأ في التحقق لحقل: ${err.path}` }}));
      return res.status(400).json(createApiResponse(enMessages.VALIDATION_ERROR, arMessages.VALIDATION_ERROR, null, false, validationErrors));
    }
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

// DELETE /categories/:categoryId - Delete a category (admin only)
exports.deleteCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const category = await Category.findByPk(categoryId);

    if (!category) {
      return res.status(404).json(createApiResponse(enMessages.NOT_FOUND, arMessages.NOT_FOUND, { detail: { en: "Category not found.", ar: "الفئة غير موجودة."}}, false));
    }

    // Check if category has products or subcategories before deleting (optional, based on business rules)
    const productsInCategory = await Product.count({ where: { category_id: categoryId } });
    const subCategories = await Category.count({ where: { parent_category_id: categoryId } });

    if (productsInCategory > 0 || subCategories > 0) {
      return res.status(400).json(createApiResponse(enMessages.DELETE_ERROR, arMessages.DELETE_ERROR, 
        { detail: { 
            en: "Category cannot be deleted because it contains products or subcategories. Please reassign or delete them first.", 
            ar: "لا يمكن حذف الفئة لأنها تحتوي على منتجات أو فئات فرعية. يرجى إعادة تعيينها أو حذفها أولاً." 
        }},
        false
      ));
    }

    await category.destroy();
    return res.status(200).json(createApiResponse(enMessages.DELETE_SUCCESS, arMessages.DELETE_SUCCESS, null, true));
  } catch (error) {
    console.error("Delete category error:", error);
    return res.status(500).json(createApiResponse(enMessages.INTERNAL_SERVER_ERROR, arMessages.INTERNAL_SERVER_ERROR, null, false));
  }
};

