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
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
