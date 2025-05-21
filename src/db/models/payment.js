const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Payment = sequelize.define("Payment", {
    payment_id: {
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
    user_id: { // User who made the payment
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "users",
        key: "user_id",
      },
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    payment_method: {
      type: DataTypes.STRING, // e.g., "credit_card", "paypal", "cash_on_delivery"
      allowNull: false,
    },
    transaction_id: { // From payment gateway
      type: DataTypes.STRING,
      allowNull: true, // May not be applicable for all methods like COD initially
      unique: true,
    },
    payment_status: {
      type: DataTypes.ENUM("pending", "succeeded", "failed", "refunded", "partially_refunded"),
      allowNull: false,
      defaultValue: "pending",
    },
    payment_gateway_response: { // Store raw response from gateway for debugging/auditing
      type: DataTypes.TEXT,
      allowNull: true,
    },
    currency: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "USD" // Or a default currency from config
    }
  }, {
    tableName: "payments",
    timestamps: true, // Adds createdAt and updatedAt
  });

  Payment.associate = (models) => {
    Payment.belongsTo(models.Order, {
      foreignKey: "order_id",
      as: "order"
    });
    Payment.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user"
    });
  };

  return Payment;
};

