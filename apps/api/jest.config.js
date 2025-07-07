export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
  ],
  moduleFileExtensions: ['ts', 'js'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  moduleNameMapper: {
    '^@arbiter/core$': '<rootDir>/../../packages/core/src',
    '^@arbiter/workflow-engine$': '<rootDir>/../../packages/workflow-engine/src',
    '^@arbiter/agent-runtime$': '<rootDir>/../../packages/agent-runtime/src',
    '^@arbiter/event-system$': '<rootDir>/../../packages/event-system/src',
    '^@arbiter/database$': '<rootDir>/../../packages/database/src',
  },
  extensionsToTreatAsEsm: ['.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!(node-fetch|fetch-blob|data-uri-to-buffer|formdata-polyfill)/)',
  ],
};