// Mock node-fetch
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

// Global fetch mock for tests that need it
global.fetch = jest.fn();