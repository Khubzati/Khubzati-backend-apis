const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Product = sequelize.define("Product", {
    product_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    bakery_id: { 
      type: DataTypes.INTEGER,
      allowNull: true, 
      references: {
        model: "bakeries",
        key: "bakery_id",
      },
    },
    restaurant_id: { 
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "restaurants",
        key: "restaurant_id",
      },
    },
    category_id: {
      type: DataTypes.INTEGER,
      allowNull: true, 
      references: { model: "categories", key: "category_id" }, // Added reference
    },
    name_en: { 
      type: DataTypes.STRING,
      allowNull: false,
    },
    name_ar: { 
      type: DataTypes.STRING,
      allowNull: false,
    },
    description_en: { 
      type: DataTypes.TEXT,
      allowNull: true,
    },
    description_ar: { 
      type: DataTypes.TEXT,
      allowNull: true,
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    sku: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    stock_quantity: {
      type: DataTypes.INTEGER,
      allowNull: true, 
      defaultValue: 0,
    },
    image_url: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    additional_images: { 
      type: DataTypes.JSON,
      allowNull: true,
    },
    is_available: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    nutritional_info_en: { 
        type: DataTypes.JSON,
        allowNull: true,
    },
    nutritional_info_ar: { 
        type: DataTypes.JSON,
        allowNull: true,
    },
    allergen_info_en: { 
        type: DataTypes.TEXT,
        allowNull: true,
    },
    allergen_info_ar: { 
        type: DataTypes.TEXT,
        allowNull: true,
    },
    average_rating: {
      type: DataTypes.DECIMAL(2, 1),
      defaultValue: 0.0,
    },
    total_ratings: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
  }, {
    tableName: "products",
    timestamps: true,
  });

  Product.associate = (models) => {
    Product.belongsTo(models.Bakery, {
      foreignKey: "bakery_id",
      as: "bakery"
    });
    Product.belongsTo(models.Restaurant, {
        foreignKey: "restaurant_id",
        as: "restaurant"
    });
    Product.belongsTo(models.Category, { // Added association
        foreignKey: "category_id", 
        as: "category" 
    });
    // Product.hasMany(models.Review, { foreignKey: 'product_id', as: 'reviews' });
    // Product.hasMany(models.OrderItem, { foreignKey: 'product_id', as: 'orderItems' });
    // Product.hasMany(models.CartItem, { foreignKey: 'product_id', as: 'cartItems' });
  };

  return Product;
};

