'use strict';
const sharedColumns = require('./shared-columns');

module.exports = (sequelize, DataTypes) => {
  const Cart = sequelize.define(
    'Cart',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        field: 'user_id',
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
      },
      totalAmount: {
        type: DataTypes.DECIMAL(10, 2),
        field: 'total_amount',
        defaultValue: 0,
      },
      ...sharedColumns(sequelize, DataTypes),
    },
    {
      tableName: 'carts',
    }
  );

  Cart.associate = (models) => {
    Cart.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'user',
    });
    
    Cart.hasMany(models.CartItem, {
      foreignKey: 'cartId',
      as: 'cartItems',
    });
  };

  return Cart;
};
