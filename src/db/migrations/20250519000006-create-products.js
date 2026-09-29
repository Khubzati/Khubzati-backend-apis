'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('products', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
      },
      price: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      image_url: {
        type: Sequelize.STRING,
      },
      item_type: {
        type: Sequelize.ENUM('bakery', 'restaurant_menu'),
        allowNull: false,
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
      category_id: {
        type: Sequelize.UUID,
        references: {
          model: 'categories',
          key: 'id',
        },
      },
      stock_quantity: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      preparation_time_minutes: {
        type: Sequelize.INTEGER,
      },
      dietary_info: {
        type: Sequelize.JSON,
      },
      is_available: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
      },
      average_rating: {
        type: Sequelize.FLOAT,
        defaultValue: 0,
      },
      review_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
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
    await queryInterface.dropTable('products');
  }
};
