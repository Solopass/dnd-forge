import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'dexie'],
          compendium: ['./src/engine/srd-packs.ts'],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    open: false,
  },
});
