const { dbHost, dbName, dbPassword, dbPort, dbUsername } = require('./config');

const defaultConfig = {
  database: dbName,
  dialect: 'postgres',
  host: dbHost,
  password: dbPassword,
  port: dbPort,
  username: dbUsername,
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
