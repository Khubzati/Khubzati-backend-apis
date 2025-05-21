const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Category = sequelize.define("Category", {
    category_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name_en: { // Bilingual field
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    name_ar: { // Bilingual field
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    description_en: { // Bilingual field
      type: DataTypes.TEXT,
      allowNull: true,
    },
    description_ar: { // Bilingual field
      type: DataTypes.TEXT,
      allowNull: true,
    },
    image_url: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    parent_category_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "categories", // Self-referencing for subcategories
        key: "category_id",
      },
    },
  }, {
    tableName: "categories",
    timestamps: true,
  });

  Category.associate = (models) => {
    Category.hasMany(models.Product, {
      foreignKey: "category_id",
      as: "products"
    });
    Category.belongsTo(models.Category, {
      foreignKey: "parent_category_id",
      as: "parentCategory"
    });
    Category.hasMany(models.Category, {
      foreignKey: "parent_category_id",
      as: "subCategories"
    });
  };

  return Category;
};

