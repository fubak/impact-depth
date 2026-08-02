import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 8080,
  },
  preview: {
    host: '0.0.0.0',
    port: 8080,
  },
  build: {
    // Three.js + game shell; split later if routes appear.
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
