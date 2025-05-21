const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const CartItem = sequelize.define("CartItem", {
    cart_item_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    cart_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "carts",
        key: "cart_id",
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
      defaultValue: 1,
      validate: {
        min: 1, // Quantity must be at least 1
      },
    },
    price_at_addition: { // Store the price of the product when it was added to cart
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    // Any specific notes or customizations for this cart item can be added here
    // e.g., notes: DataTypes.STRING
  }, {
    tableName: "cart_items",
    timestamps: true, // Adds createdAt and updatedAt
  });

  CartItem.associate = (models) => {
    CartItem.belongsTo(models.Cart, {
      foreignKey: "cart_id",
      as: "cart"
    });
    CartItem.belongsTo(models.Product, {
      foreignKey: "product_id",
      as: "product"
    });
  };

  return CartItem;
};

