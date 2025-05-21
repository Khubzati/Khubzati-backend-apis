const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Bakery = sequelize.define("Bakery", {
    bakery_id: {
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
      type: DataTypes.JSON, // As per schema: {"Mon": "9am-5pm", ...}
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
  }, {
    tableName: "bakeries",
    timestamps: true,
  });

  Bakery.associate = (models) => {
    Bakery.belongsTo(models.User, {
      foreignKey: "owner_id",
      as: "owner"
    });
    // Bakery.hasMany(models.Product, { foreignKey: 'bakery_id', as: 'products' }); // To be added when Product model is created
    // Bakery.hasMany(models.Review, { foreignKey: 'bakery_id', as: 'reviews' }); // To be added when Review model is created
  };

  return Bakery;
};

