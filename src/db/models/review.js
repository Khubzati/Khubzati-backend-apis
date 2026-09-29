'use strict';
const sharedColumns = require('./shared-columns');

module.exports = (sequelize, DataTypes) => {
  const Review = sequelize.define(
    'Review',
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
      rating: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
          min: 1,
          max: 5,
        },
      },
      comment: {
        type: DataTypes.TEXT,
      },
      reviewType: {
        type: DataTypes.ENUM('product', 'bakery', 'restaurant'),
        field: 'review_type',
        allowNull: false,
      },
      productId: {
        type: DataTypes.UUID,
        field: 'product_id',
        references: {
          model: 'products',
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
      ...sharedColumns(sequelize, DataTypes),
    },
    {
      tableName: 'reviews',
      validate: {
        validateReviewType() {
          if (this.reviewType === 'product' && !this.productId) {
            throw new Error('Product ID is required for product reviews');
          }
          if (this.reviewType === 'bakery' && !this.bakeryId) {
            throw new Error('Bakery ID is required for bakery reviews');
          }
          if (this.reviewType === 'restaurant' && !this.restaurantId) {
            throw new Error('Restaurant ID is required for restaurant reviews');
          }
        },
      },
    }
  );

  Review.associate = (models) => {
    Review.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'user',
    });
    
    Review.belongsTo(models.Product, {
      foreignKey: 'productId',
      as: 'product',
    });
    
    Review.belongsTo(models.Bakery, {
      foreignKey: 'bakeryId',
      as: 'bakery',
    });
    
    Review.belongsTo(models.Restaurant, {
      foreignKey: 'restaurantId',
      as: 'restaurant',
    });
  };

  return Review;
};
