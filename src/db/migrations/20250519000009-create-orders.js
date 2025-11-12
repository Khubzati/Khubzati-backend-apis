'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('orders', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
      },
      bakery_id: {
        type: Sequelize.UUID,
        references: {
          model: 'bakeries',
          key: 'id',
        },
      },
      restaurant_id: {
        type: Sequelize.UUID,
        references: {
          model: 'restaurants',
          key: 'id',
        },
      },
      order_number: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      status: {
        type: Sequelize.ENUM(
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
      order_type: {
        type: Sequelize.ENUM('pickup', 'delivery'),
        allowNull: false,
      },
      delivery_address_id: {
        type: Sequelize.UUID,
        references: {
          model: 'addresses',
          key: 'id',
        },
      },
      total_amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      payment_method: {
        type: Sequelize.ENUM('credit_card', 'debit_card', 'cash_on_delivery', 'wallet'),
        allowNull: false,
      },
      payment_status: {
        type: Sequelize.ENUM('pending', 'paid', 'failed', 'refunded'),
        defaultValue: 'pending',
      },
      special_instructions: {
        type: Sequelize.TEXT,
      },
      estimated_delivery_time: {
        type: Sequelize.DATE,
      },
      actual_delivery_time: {
        type: Sequelize.DATE,
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
        allowNull: false,
      },
      created_by: {
        type: Sequelize.UUID,
        references: {
          model: 'users',
          key: 'id',
        },
      },
      updated_at: {
        type: Sequelize.DATE,
      },
      updated_by: {
        type: Sequelize.UUID,
        references: {
          model: 'users',
          key: 'id',
        },
      },
      deleted_at: {
        type: Sequelize.DATE,
      },
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('orders');
  }
};
