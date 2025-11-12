'use strict';
const sharedColumns = require('./shared-columns');

module.exports = (sequelize, DataTypes) => {
  const Bakery = sequelize.define(
    'Bakery',
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
      addressLine1: {
        type: DataTypes.STRING,
        field: 'address_line1',
        allowNull: false,
      },
      addressLine2: {
        type: DataTypes.STRING,
        field: 'address_line2',
      },
      city: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      postalCode: {
        type: DataTypes.STRING,
        field: 'postal_code',
        allowNull: false,
      },
      country: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'Saudi Arabia',
      },
      phoneNumber: {
        type: DataTypes.STRING,
        field: 'phone_number',
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING,
        validate: {
          isEmail: true,
        },
      },
      logoUrl: {
        type: DataTypes.STRING,
        field: 'logo_url',
      },
      coverImageUrl: {
        type: DataTypes.STRING,
        field: 'cover_image_url',
      },
      operatingHours: {
        type: DataTypes.JSON,
        field: 'operating_hours',
      },
      status: {
        type: DataTypes.ENUM('pending_approval', 'approved', 'rejected'),
        defaultValue: 'pending_approval',
      },
      ownerId: {
        type: DataTypes.UUID,
        field: 'owner_id',
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
      },
      averageRating: {
        type: DataTypes.FLOAT,
        field: 'average_rating',
        defaultValue: 0,
      },
      reviewCount: {
        type: DataTypes.INTEGER,
        field: 'review_count',
        defaultValue: 0,
      },
      ...sharedColumns(sequelize, DataTypes),
    },
    {
      tableName: 'bakeries',
    }
  );

  Bakery.associate = (models) => {
    Bakery.belongsTo(models.User, {
      foreignKey: 'ownerId',
      as: 'owner',
    });
    
    Bakery.hasMany(models.Product, {
      foreignKey: 'bakeryId',
      as: 'products',
    });
    
    Bakery.hasMany(models.Review, {
      foreignKey: 'bakeryId',
      as: 'reviews',
    });
    
    Bakery.hasMany(models.Order, {
      foreignKey: 'bakeryId',
      as: 'orders',
    });
  };

  return Bakery;
};
