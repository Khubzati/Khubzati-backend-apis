module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  clearMocks: true,
  globalTeardown: '<rootDir>/scripts/jest-global-teardown.js',
  setupFilesAfterEnv: [],
};
