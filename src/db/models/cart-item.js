'use strict';
const sharedColumns = require('./shared-columns');

module.exports = (sequelize, DataTypes) => {
  const CartItem = sequelize.define(
    'CartItem',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      cartId: {
        type: DataTypes.UUID,
        field: 'cart_id',
        allowNull: false,
        references: {
          model: 'carts',
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
      tableName: 'cart_items',
      hooks: {
        beforeValidate: (cartItem) => {
          if (cartItem.price && cartItem.quantity) {
            cartItem.subtotal = cartItem.price * cartItem.quantity;
          }
        },
      },
    }
  );

  CartItem.associate = (models) => {
    CartItem.belongsTo(models.Cart, {
      foreignKey: 'cartId',
      as: 'cart',
    });
    
    CartItem.belongsTo(models.Product, {
      foreignKey: 'productId',
      as: 'product',
    });
  };

  return CartItem;
};
