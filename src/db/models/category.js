'use strict';
const sharedColumns = require('./shared-columns');

module.exports = (sequelize, DataTypes) => {
  const Category = sequelize.define(
    'Category',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
      },
      imageUrl: {
        type: DataTypes.STRING,
        field: 'image_url',
      },
      type: {
        type: DataTypes.ENUM('bakery', 'restaurant', 'common'),
        allowNull: false,
        defaultValue: 'common',
      },
      parentCategoryId: {
        type: DataTypes.UUID,
        field: 'parent_category_id',
        references: {
          model: 'categories',
          key: 'id',
        },
      },
      ...sharedColumns(sequelize, DataTypes),
    },
    {
      tableName: 'categories',
    }
  );

  Category.associate = (models) => {
    Category.belongsTo(Category, {
      foreignKey: 'parentCategoryId',
      as: 'parentCategory',
    });
    
    Category.hasMany(Category, {
      foreignKey: 'parentCategoryId',
      as: 'subcategories',
    });
    
    Category.hasMany(models.Product, {
      foreignKey: 'categoryId',
      as: 'products',
    });
  };

  return Category;
};
