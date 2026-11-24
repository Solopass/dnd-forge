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
          rulesEngine: [
            './src/engine/rules-math.ts',
            './src/engine/combat-machine.ts',
            './src/engine/classes.ts',
            './src/engine/dice.ts',
            './src/engine/live-sync.ts',
          ],
          compendium: ['./src/engine/srd-packs.ts'],
          dmHub: ['./src/engine/dm-tools.ts'],
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
