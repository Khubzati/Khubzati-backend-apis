const express = require("express");
const router = express.Router();
const categoryController = require("../controllers/categoryController");
const { protect, authorize } = require("../middleware/authMiddleware");

// Public routes
router.get("/", categoryController.listCategories);
router.get("/:categoryId", categoryController.getCategoryDetails);

// Admin only routes
router.post("/", protect, authorize("admin"), categoryController.createCategory);
router.put("/:categoryId", protect, authorize("admin"), categoryController.updateCategory);
router.delete("/:categoryId", protect, authorize("admin"), categoryController.deleteCategory);

module.exports = router;

