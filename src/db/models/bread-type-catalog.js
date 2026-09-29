'use strict';
const sharedColumns = require('./shared-columns');

module.exports = (sequelize, DataTypes) => {
  const BreadTypeCatalog = sequelize.define(
    'BreadTypeCatalog',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      key: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      englishName: {
        type: DataTypes.STRING,
        allowNull: false,
        field: 'english_name',
      },
      arabicName: {
        type: DataTypes.STRING,
        field: 'arabic_name',
      },
      imageUrl: {
        type: DataTypes.STRING,
        field: 'image_url',
      },
      imageSource: {
        type: DataTypes.STRING,
        field: 'image_source',
      },
      imageCredit: {
        type: DataTypes.STRING,
        field: 'image_credit',
      },
      description: {
        type: DataTypes.TEXT,
      },
      tags: {
        type: DataTypes.JSON,
      },
      sortOrder: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        field: 'sort_order',
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: 'is_active',
      },
      ...sharedColumns(sequelize, DataTypes),
    },
    {
      tableName: 'bread_type_catalog',
    }
  );

  return BreadTypeCatalog;
};
