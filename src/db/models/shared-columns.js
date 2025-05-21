module.exports = (sequelize, DataTypes) => ({
  createdAt: {
    type: DataTypes.DATE,
    field: 'created_at',
    defaultValue: DataTypes.NOW,
  },
  createdBy: {
    type: DataTypes.UUID,
    field: 'created_by',
    references: {
      model: 'users',
      key: 'id',
    },
  },
  updatedAt: {
    type: DataTypes.DATE,
    field: 'updated_at',
    defaultValue: null,
  },
  updatedBy: {
    type: DataTypes.UUID,
    field: 'updated_by',
    references: {
      model: 'users',
      key: 'id',
    },
  },
  deletedAt: {
    type: DataTypes.DATE,
    field: 'deleted_at',
  },
});
