/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'jest-environment-jsdom',
  modulePathIgnorePatterns: ['<rootDir>/examples', '<rootDir>/dist'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        // Force ts-jest to handle ESM
        module: 'ESNext'
      }
    }]
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  // Several tests spy on FormData.prototype.append without restoring it.
  // Restoring globally keeps a spy from leaking into later tests and creating
  // order-dependent failures.
  restoreMocks: true
};

export default config;