/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src/tests'],
  testMatch: ['**/*.test.js'],
  transform: {},
  // Allow CommonJS modules
  moduleFileExtensions: ['js', 'json'],
  // 30 second timeout for integration tests
  testTimeout: 30000,
  // Show individual test results
  verbose: true,
  // Force exit after tests complete (handles dangling handles)
  forceExit: true,
  // Detect open handles
  detectOpenHandles: true,
};
