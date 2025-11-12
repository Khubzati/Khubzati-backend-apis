'use strict';
const sharedColumns = require('./shared-columns');

module.exports = (sequelize, DataTypes) => {
  const OrderItem = sequelize.define(
    'OrderItem',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      orderId: {
        type: DataTypes.UUID,
        field: 'order_id',
        allowNull: false,
        references: {
          model: 'orders',
          key: 'id',
        },
      },
      productId: {
        type: DataTypes.UUID,
        field: 'product_id',
        allowNull: false,
        references: {
          model: 'products',
          key: 'id',
        },
      },
      quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      subtotal: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      specialInstructions: {
        type: DataTypes.TEXT,
        field: 'special_instructions',
      },
      ...sharedColumns(sequelize, DataTypes),
    },
    {
      tableName: 'order_items',
      hooks: {
        beforeValidate: (orderItem) => {
          if (orderItem.price && orderItem.quantity) {
            orderItem.subtotal = orderItem.price * orderItem.quantity;
          }
        },
      },
    }
  );

  OrderItem.associate = (models) => {
    OrderItem.belongsTo(models.Order, {
      foreignKey: 'orderId',
      as: 'order',
    });
    
    OrderItem.belongsTo(models.Product, {
      foreignKey: 'productId',
      as: 'product',
    });
  };

  return OrderItem;
};
