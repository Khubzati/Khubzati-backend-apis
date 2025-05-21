const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Review = sequelize.define("Review", {
    review_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "users",
        key: "user_id",
      },
    },
    product_id: {
      type: DataTypes.INTEGER,
      allowNull: true, // Review can be for a product, bakery, or restaurant
      references: {
        model: "products",
        key: "product_id",
      },
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
    order_id: { // Optional: link review to a specific order
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: "orders",
            key: "order_id"
        }
    },
    rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5,
      },
    },
    comment_en: { // Bilingual field
      type: DataTypes.TEXT,
      allowNull: true,
    },
    comment_ar: { // Bilingual field
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // review_images: { // Array of image URLs for the review
    //   type: DataTypes.JSON,
    //   allowNull: true,
    // },
    // is_approved: { // If reviews need moderation
    //   type: DataTypes.BOOLEAN,
    //   defaultValue: true, // Or false if moderation is default
    // },
  }, {
    tableName: "reviews",
    timestamps: true, // Adds createdAt and updatedAt
  });

  Review.associate = (models) => {
    Review.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user"
    });
    Review.belongsTo(models.Product, {
      foreignKey: "product_id",
      as: "product"
    });
    Review.belongsTo(models.Bakery, {
      foreignKey: "bakery_id",
      as: "bakery"
    });
    Review.belongsTo(models.Restaurant, {
      foreignKey: "restaurant_id",
      as: "restaurant"
    });
    Review.belongsTo(models.Order, {
        foreignKey: "order_id",
        as: "order"
    });
  };

  return Review;
};

