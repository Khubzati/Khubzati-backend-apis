const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Address = sequelize.define("Address", {
    address_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "users", // Name of the table, not the model
        key: "user_id",
      },
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
      defaultValue: "DefaultCountry", // As per schema doc
    },
    address_type: {
      type: DataTypes.ENUM("home", "work", "other"),
      allowNull: true,
      defaultValue: "home",
    },
    is_default: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    latitude: {
      type: DataTypes.DECIMAL(10, 8), // Precision and scale for lat/lng
      allowNull: true,
    },
    longitude: {
      type: DataTypes.DECIMAL(11, 8), // Precision and scale for lat/lng
      allowNull: true,
    },
  }, {
    tableName: "addresses",
    timestamps: true,
  });

  Address.associate = (models) => {
    Address.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user"
    });
  };

  return Address;
};

