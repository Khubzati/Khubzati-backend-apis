'use strict';
const sharedColumns = require('./shared-columns');

module.exports = (sequelize, DataTypes) => {
  const Order = sequelize.define(
    'Order',
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
      bakeryId: {
        type: DataTypes.UUID,
        field: 'bakery_id',
        references: {
          model: 'bakeries',
          key: 'id',
        },
      },
      restaurantId: {
        type: DataTypes.UUID,
        field: 'restaurant_id',
        references: {
          model: 'restaurants',
          key: 'id',
        },
      },
      orderNumber: {
        type: DataTypes.STRING,
        field: 'order_number',
        allowNull: false,
        unique: true,
      },
      status: {
        type: DataTypes.ENUM(
          'pending',
          'confirmed',
          'preparing',
          'ready_for_pickup',
          'out_for_delivery',
          'delivered',
          'completed',
          'cancelled'
        ),
        defaultValue: 'pending',
      },
      orderType: {
        type: DataTypes.ENUM('pickup', 'delivery'),
        field: 'order_type',
        allowNull: false,
      },
      deliveryAddressId: {
        type: DataTypes.UUID,
        field: 'delivery_address_id',
        references: {
          model: 'addresses',
          key: 'id',
        },
      },
      totalAmount: {
        type: DataTypes.DECIMAL(10, 2),
        field: 'total_amount',
        allowNull: false,
      },
      paymentMethod: {
        type: DataTypes.ENUM('credit_card', 'debit_card', 'cash_on_delivery', 'wallet'),
        field: 'payment_method',
        allowNull: false,
      },
      paymentStatus: {
        type: DataTypes.ENUM('pending', 'paid', 'failed', 'refunded'),
        field: 'payment_status',
        defaultValue: 'pending',
      },
      specialInstructions: {
        type: DataTypes.TEXT,
        field: 'special_instructions',
      },
      estimatedDeliveryTime: {
        type: DataTypes.DATE,
        field: 'estimated_delivery_time',
      },
      actualDeliveryTime: {
        type: DataTypes.DATE,
        field: 'actual_delivery_time',
      },
      ...sharedColumns(sequelize, DataTypes),
    },
    {
      tableName: 'orders',
      validate: {
        orderTypeValidation() {
          if (this.orderType === 'delivery' && !this.deliveryAddressId) {
            throw new Error('Delivery address is required for delivery orders');
          }
        },
        establishmentValidation() {
          if (!this.bakeryId && !this.restaurantId) {
            throw new Error('Either bakery or restaurant ID must be provided');
          }
          if (this.bakeryId && this.restaurantId) {
            throw new Error('Order cannot be associated with both bakery and restaurant');
          }
        },
      },
      hooks: {
        beforeCreate: (order) => {
          // Generate a unique order number
          const timestamp = new Date().getTime();
          const random = Math.floor(Math.random() * 1000);
          order.orderNumber = `KHB-${timestamp}-${random}`;
        },
      },
    }
  );

  Order.associate = (models) => {
    Order.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'user',
    });
    
    Order.belongsTo(models.Bakery, {
      foreignKey: 'bakeryId',
      as: 'bakery',
    });
    
    Order.belongsTo(models.Restaurant, {
      foreignKey: 'restaurantId',
      as: 'restaurant',
    });
    
    Order.belongsTo(models.Address, {
      foreignKey: 'deliveryAddressId',
      as: 'deliveryAddress',
    });
    
    Order.hasMany(models.OrderItem, {
      foreignKey: 'orderId',
      as: 'orderItems',
    });
  };

  return Order;
};
