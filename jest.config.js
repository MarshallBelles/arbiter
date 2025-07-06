export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  projects: [
    {
      displayName: 'core',
      testMatch: ['<rootDir>/packages/core/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
      transform: {
        '^.+\\.ts$': ['ts-jest', {
          useESM: false,
        }],
      },
      moduleNameMapper: {
        '^@arbiter/(.*)$': '<rootDir>/packages/$1/src',
      },
    },
    {
      displayName: 'workflow-engine',
      testMatch: ['<rootDir>/packages/workflow-engine/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
      transform: {
        '^.+\\.ts$': ['ts-jest', {
          useESM: false,
        }],
      },
      moduleNameMapper: {
        '^@arbiter/(.*)$': '<rootDir>/packages/$1/src',
      },
    },
    {
      displayName: 'agent-runtime',
      testMatch: ['<rootDir>/packages/agent-runtime/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
      transform: {
        '^.+\\.ts$': ['ts-jest', {
          useESM: false,
        }],
      },
      moduleNameMapper: {
        '^@arbiter/(.*)$': '<rootDir>/packages/$1/src',
      },
      transformIgnorePatterns: [
        'node_modules/(?!(node-fetch|fetch-blob|data-uri-to-buffer|formdata-polyfill)/)',
      ],
    },
    {
      displayName: 'event-system',
      testMatch: ['<rootDir>/packages/event-system/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
      transform: {
        '^.+\\.ts$': ['ts-jest', {
          useESM: false,
        }],
      },
      moduleNameMapper: {
        '^@arbiter/(.*)$': '<rootDir>/packages/$1/src',
      },
    },
    {
      displayName: 'api',
      testMatch: ['<rootDir>/apps/api/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
      transform: {
        '^.+\\.ts$': ['ts-jest', {
          useESM: false,
        }],
      },
      moduleNameMapper: {
        '^@arbiter/(.*)$': '<rootDir>/packages/$1/src',
      },
      transformIgnorePatterns: [
        'node_modules/(?!(node-fetch|fetch-blob|data-uri-to-buffer|formdata-polyfill)/)',
      ],
    },
  ],
  collectCoverageFrom: [
    'packages/**/*.ts',
    'apps/api/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};