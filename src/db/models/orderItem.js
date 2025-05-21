const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const OrderItem = sequelize.define("OrderItem", {
    order_item_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    order_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "orders",
        key: "order_id",
      },
    },
    product_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "products",
        key: "product_id",
      },
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
      },
    },
    price_at_purchase: { // Price of the product at the time of order
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    // Store product name and image at time of purchase for historical accuracy, if needed
    // product_name_en_snapshot: DataTypes.STRING,
    // product_name_ar_snapshot: DataTypes.STRING,
    // product_image_snapshot: DataTypes.STRING,
  }, {
    tableName: "order_items",
    timestamps: true, // Adds createdAt and updatedAt
  });

  OrderItem.associate = (models) => {
    OrderItem.belongsTo(models.Order, {
      foreignKey: "order_id",
      as: "order"
    });
    OrderItem.belongsTo(models.Product, {
      foreignKey: "product_id",
      as: "product"
    });
  };

  return OrderItem;
};

