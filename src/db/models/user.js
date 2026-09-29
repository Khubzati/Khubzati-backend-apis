'use strict';
const bcrypt = require('bcryptjs');
const sharedColumns = require('./shared-columns');

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      password: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      fullName: {
        type: DataTypes.STRING,
        field: 'full_name',
      },
      phoneNumber: {
        type: DataTypes.STRING,
        field: 'phone_number',
      },
      role: {
        type: DataTypes.ENUM('customer', 'bakery_owner', 'restaurant_owner', 'admin'),
        defaultValue: 'customer',
      },
      isVerified: {
        type: DataTypes.BOOLEAN,
        field: 'is_verified',
        defaultValue: false,
      },
      profilePictureUrl: {
        type: DataTypes.STRING,
        field: 'profile_picture_url',
      },
      ...sharedColumns(sequelize, DataTypes),
    },
    {
      tableName: 'users',
      hooks: {
        beforeCreate: async (user) => {
          if (user.password) {
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(user.password, salt);
          }
        },
        beforeUpdate: async (user) => {
          if (user.changed('password')) {
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(user.password, salt);
          }
        },
      },
    }
  );

  User.prototype.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
  };

  User.associate = (models) => {
    User.hasMany(models.Address, {
      foreignKey: 'userId',
      as: 'addresses',
    });
    
    User.hasMany(models.Review, {
      foreignKey: 'userId',
      as: 'reviews',
    });
    
    User.hasOne(models.Cart, {
      foreignKey: 'userId',
      as: 'cart',
    });
    
    User.hasMany(models.Order, {
      foreignKey: 'userId',
      as: 'orders',
    });
    
    User.hasMany(models.Notification, {
      foreignKey: 'userId',
      as: 'notifications',
    });
  };

  return User;
};
