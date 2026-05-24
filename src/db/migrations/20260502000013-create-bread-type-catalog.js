'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('bread_type_catalog', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      key: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      english_name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      arabic_name: {
        type: Sequelize.STRING,
      },
      image_url: {
        type: Sequelize.STRING,
      },
      image_source: {
        type: Sequelize.STRING,
      },
      image_credit: {
        type: Sequelize.STRING,
      },
      description: {
        type: Sequelize.TEXT,
      },
      tags: {
        type: Sequelize.JSON,
      },
      sort_order: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      created_by: {
        type: Sequelize.UUID,
      },
      updated_at: {
        type: Sequelize.DATE,
      },
      updated_by: {
        type: Sequelize.UUID,
      },
      deleted_at: {
        type: Sequelize.DATE,
      },
    });

    await queryInterface.addIndex('bread_type_catalog', ['is_active', 'sort_order']);
    await queryInterface.addIndex('bread_type_catalog', ['deleted_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('bread_type_catalog');
  },
};
