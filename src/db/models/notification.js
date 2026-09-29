'use strict';
const sharedColumns = require('./shared-columns');

module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define(
    'Notification',
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
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM('order', 'system', 'promotion', 'account'),
        allowNull: false,
        defaultValue: 'system',
      },
      isRead: {
        type: DataTypes.BOOLEAN,
        field: 'is_read',
        defaultValue: false,
      },
      relatedId: {
        type: DataTypes.UUID,
        field: 'related_id',
        comment: 'ID of related entity (order, etc.)',
      },
      ...sharedColumns(sequelize, DataTypes),
    },
    {
      tableName: 'notifications',
    }
  );

  Notification.associate = (models) => {
    Notification.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'user',
    });
  };

  return Notification;
};
