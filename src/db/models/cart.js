const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Cart = sequelize.define("Cart", {
    cart_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true, // A user should only have one active cart
      references: {
        model: "users",
        key: "user_id",
      },
    },
    // total_price: { // This can be calculated dynamically or stored if needed for performance/history
    //   type: DataTypes.DECIMAL(10, 2),
    //   allowNull: false,
    //   defaultValue: 0.00,
    // },
    // last_updated: { // Timestamps will handle this
    //   type: DataTypes.DATE,
    //   defaultValue: DataTypes.NOW,
    // },
  }, {
    tableName: "carts",
    timestamps: true, // Adds createdAt and updatedAt
  });

  Cart.associate = (models) => {
    Cart.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user"
    });
    Cart.hasMany(models.CartItem, { // To be created
      foreignKey: "cart_id",
      as: "items"
    });
  };

  return Cart;
};

