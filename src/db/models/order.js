const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Order = sequelize.define("Order", {
    order_id: {
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
    bakery_id: { // If order is from a specific bakery
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "bakeries",
        key: "bakery_id",
      },
    },
    restaurant_id: { // If order is from a specific restaurant
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "restaurants",
        key: "restaurant_id",
      },
    },
    delivery_address_id: { // Link to a user's address or store address snapshot
      type: DataTypes.INTEGER,
      allowNull: true, // May be null for pickup orders
      references: {
        model: "addresses",
        key: "address_id",
      },
    },
    // Or store address snapshot directly if addresses can change/be deleted
    // shipping_address_snapshot: DataTypes.JSON, 
    billing_address_id: {
        type: DataTypes.INTEGER,
        allowNull: true, 
        references: {
          model: "addresses",
          key: "address_id",
        },
    },
    // billing_address_snapshot: DataTypes.JSON,
    total_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    sub_total: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
    },
    delivery_fee: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0.00
    },
    service_fee: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0.00
    },
    discount_amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0.00
    },
    payment_method: {
      type: DataTypes.STRING, // e.g., "credit_card", "cash_on_delivery"
      allowNull: true,
    },
    payment_status: {
      type: DataTypes.ENUM("pending", "paid", "failed", "refunded"),
      defaultValue: "pending",
    },
    order_status: {
      type: DataTypes.ENUM(
        "pending_confirmation", 
        "confirmed", 
        "preparing", 
        "ready_for_pickup", 
        "out_for_delivery", 
        "delivered", 
        "cancelled", 
        "failed_delivery"
      ),
      defaultValue: "pending_confirmation",
    },
    special_instructions: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    estimated_delivery_time: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    actual_delivery_time: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // driver_id: { // Link to a Driver model if implemented
    //   type: DataTypes.INTEGER,
    //   allowNull: true,
    // },
  }, {
    tableName: "orders",
    timestamps: true, // Adds createdAt and updatedAt
  });

  Order.associate = (models) => {
    Order.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "customer"
    });
    Order.belongsTo(models.Bakery, {
      foreignKey: "bakery_id",
      as: "bakery"
    });
    Order.belongsTo(models.Restaurant, {
      foreignKey: "restaurant_id",
      as: "restaurant"
    });
    Order.belongsTo(models.Address, {
      foreignKey: "delivery_address_id",
      as: "deliveryAddress"
    });
    Order.belongsTo(models.Address, {
        foreignKey: "billing_address_id",
        as: "billingAddress"
      });
    Order.hasMany(models.OrderItem, { // To be created
      foreignKey: "order_id",
      as: "items"
    });
    // Order.hasOne(models.Payment, { foreignKey: 'order_id', as: 'payment' }); // To be created
    // Order.hasMany(models.Review, { foreignKey: 'order_id', as: 'reviews' }); // If reviews are per order
  };

  return Order;
};

