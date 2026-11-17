import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    // Each worker is a jsdom with the whole i18n dictionary; one per core ran out of memory on
    // machines with a few GB free. VITEST_MAX_WORKERS raises it where memory allows.
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS) || 2,
  },
});
