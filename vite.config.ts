// @ts-expect-error node builtin; the game tsconfig only loads vite/client
import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
})();

export default defineConfig({
  define: {
    'import.meta.env.VITE_COMMIT': JSON.stringify(commit),
  },
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
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.mjs'],
    // Sim-heavy playtests are CPU-bound single steps; on a contended box too
    // many workers starve the main thread and trip the 60s worker RPC timeout.
    maxWorkers: 2,
    pool: 'threads',
  },
});
