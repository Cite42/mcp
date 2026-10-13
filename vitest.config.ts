import { defineConfig } from 'vitest/config';

/** Tests must run offline: the Cite42 REST API is always mocked via global fetch. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
