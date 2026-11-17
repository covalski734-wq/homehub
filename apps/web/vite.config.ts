import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// Local API = `wrangler dev` (apps/api) on port 8787.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin in development: the browser sees one origin, cookies stay first-party,
    proxy: { '/api': { target: apiTarget, changeOrigin: false, xfwd: true } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: apiTarget, changeOrigin: false, xfwd: true } },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ['recharts'],
          vendor: [
            'react',
            'react-dom',
            'react-router',
            '@tanstack/react-query',
            '@tanstack/react-table',
          ],
        },
      },
    },
  },
});
