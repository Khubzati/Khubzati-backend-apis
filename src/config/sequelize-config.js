const { dbUrl } = require('./config');

const defaultConfig = {
  url: dbUrl,
  dialect: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  },
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  seederStorage: 'sequelize',
  timestamps: true,
  underscored: true,
  paranoid: true,
};

/**
 * The config object for sequelize-cli.
 */
module.exports = {
  development: defaultConfig,
  test: defaultConfig,
  production: defaultConfig,
};
