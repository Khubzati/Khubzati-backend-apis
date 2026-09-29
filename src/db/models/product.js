'use strict';
const sharedColumns = require('./shared-columns');

module.exports = (sequelize, DataTypes) => {
  const Product = sequelize.define(
    'Product',
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
      price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      imageUrl: {
        type: DataTypes.STRING,
        field: 'image_url',
      },
      itemType: {
        type: DataTypes.ENUM('bakery', 'restaurant_menu'),
        field: 'item_type',
        allowNull: false,
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
      categoryId: {
        type: DataTypes.UUID,
        field: 'category_id',
        references: {
          model: 'categories',
          key: 'id',
        },
      },
      stockQuantity: {
        type: DataTypes.INTEGER,
        field: 'stock_quantity',
        defaultValue: 0,
      },
      preparationTimeMinutes: {
        type: DataTypes.INTEGER,
        field: 'preparation_time_minutes',
      },
      dietaryInfo: {
        type: DataTypes.JSON,
        field: 'dietary_info',
      },
      isAvailable: {
        type: DataTypes.BOOLEAN,
        field: 'is_available',
        defaultValue: true,
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
      tableName: 'products',
      validate: {
        eitherBakeryOrRestaurant() {
          if (this.itemType === 'bakery' && !this.bakeryId) {
            throw new Error('Bakery ID is required for bakery items');
          }
          if (this.itemType === 'restaurant_menu' && !this.restaurantId) {
            throw new Error('Restaurant ID is required for restaurant menu items');
          }
        },
      },
    }
  );

  Product.associate = (models) => {
    Product.belongsTo(models.Bakery, {
      foreignKey: 'bakeryId',
      as: 'bakery',
    });
    
    Product.belongsTo(models.Restaurant, {
      foreignKey: 'restaurantId',
      as: 'restaurant',
    });
    
    Product.belongsTo(models.Category, {
      foreignKey: 'categoryId',
      as: 'category',
    });
    
    Product.hasMany(models.Review, {
      foreignKey: 'productId',
      as: 'reviews',
    });
    
    Product.hasMany(models.CartItem, {
      foreignKey: 'productId',
      as: 'cartItems',
    });
    
    Product.hasMany(models.OrderItem, {
      foreignKey: 'productId',
      as: 'orderItems',
    });
  };

  return Product;
};
