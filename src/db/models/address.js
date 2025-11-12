'use strict';
const sharedColumns = require('./shared-columns');

module.exports = (sequelize, DataTypes) => {
  const Address = sequelize.define(
    'Address',
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
      addressType: {
        type: DataTypes.ENUM('home', 'work', 'other'),
        field: 'address_type',
        defaultValue: 'home',
      },
      isDefault: {
        type: DataTypes.BOOLEAN,
        field: 'is_default',
        defaultValue: false,
      },
      latitude: {
        type: DataTypes.DECIMAL(10, 8),
      },
      longitude: {
        type: DataTypes.DECIMAL(11, 8),
      },
      ...sharedColumns(sequelize, DataTypes),
    },
    {
      tableName: 'addresses',
    }
  );

  Address.associate = (models) => {
    Address.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'user',
    });
    
    Address.hasMany(models.Order, {
      foreignKey: 'deliveryAddressId',
      as: 'orders',
    });
  };

  return Address;
};
