const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Restaurant = sequelize.define("Restaurant", {
    restaurant_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    owner_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "users",
        key: "user_id",
      },
    },
    name_en: { // Bilingual field
      type: DataTypes.STRING,
      allowNull: false,
    },
    name_ar: { // Bilingual field
      type: DataTypes.STRING,
      allowNull: false,
    },
    description_en: { // Bilingual field
      type: DataTypes.TEXT,
      allowNull: true,
    },
    description_ar: { // Bilingual field
      type: DataTypes.TEXT,
      allowNull: true,
    },
    cuisine_type_en: { // Bilingual field
        type: DataTypes.STRING,
        allowNull: true,
    },
    cuisine_type_ar: { // Bilingual field
        type: DataTypes.STRING,
        allowNull: true,
    },
    profile_image_url: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    cover_image_url: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    address_line1: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    address_line2: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    city: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    state_province_region: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    postal_code: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    country: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "DefaultCountry",
    },
    phone_number: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isEmail: true,
      },
    },
    operating_hours: {
      type: DataTypes.JSON, // e.g., {"Mon": "10am-10pm", ...}
      allowNull: true,
    },
    latitude: {
      type: DataTypes.DECIMAL(10, 8),
      allowNull: true,
    },
    longitude: {
      type: DataTypes.DECIMAL(11, 8),
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("pending_approval", "approved", "rejected", "suspended"),
      defaultValue: "pending_approval",
    },
    average_rating: {
      type: DataTypes.DECIMAL(2, 1),
      defaultValue: 0.0,
    },
    total_ratings: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    // Specific to restaurants as per schema
    table_booking_available: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    delivery_available: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
    },
    pickup_available: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
    }
  }, {
    tableName: "restaurants",
    timestamps: true,
  });

  Restaurant.associate = (models) => {
    Restaurant.belongsTo(models.User, {
      foreignKey: "owner_id",
      as: "owner"
    });
    // Restaurant.hasMany(models.Product, { foreignKey: 'restaurant_id', as: 'products' }); // If restaurants also sell products directly
    // Restaurant.hasMany(models.Review, { foreignKey: 'restaurant_id', as: 'reviews' });
    // Restaurant.hasMany(models.Order, { foreignKey: 'restaurant_id', as: 'orders' });
  };

  return Restaurant;
};

