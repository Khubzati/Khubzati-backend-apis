const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Notification = sequelize.define("Notification", {
    notification_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: { // The user who receives the notification
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "users",
        key: "user_id",
      },
    },
    type: {
      type: DataTypes.STRING, // e.g., "order_status_update", "new_promotion", "review_reply"
      allowNull: false,
    },
    title_en: { // Bilingual field
      type: DataTypes.STRING,
      allowNull: false,
    },
    title_ar: { // Bilingual field
      type: DataTypes.STRING,
      allowNull: false,
    },
    message_en: { // Bilingual field
      type: DataTypes.TEXT,
      allowNull: false,
    },
    message_ar: { // Bilingual field
      type: DataTypes.TEXT,
      allowNull: false,
    },
    is_read: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    read_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // Optional: Link to a relevant entity (e.g., order, product, review)
    related_entity_type: {
        type: DataTypes.STRING, // e.g., "order", "product"
        allowNull: true,
    },
    related_entity_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    }
  }, {
    tableName: "notifications",
    timestamps: true, // Adds createdAt and updatedAt
  });

  Notification.associate = (models) => {
    Notification.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user"
    });
    // Dynamic association based on related_entity_type can be handled in service layer if needed
  };

  return Notification;
};

