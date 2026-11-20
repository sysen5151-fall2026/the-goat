import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Keep risk tests independent of the app's Cloudflare/Sites Vite plugins.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      'next/server': fileURLToPath(new URL('./tests/risk/http-response.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/risk/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
});
