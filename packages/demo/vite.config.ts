import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  base: '/THREE_materials_tsl/',
  server: {
    fs: {
      allow: ['..']
    }
  },
  resolve: {
    dedupe: ['three'],
    alias: {
      '@loader': path.resolve(__dirname, '../loader/src/index.ts'),
      '@exporter': path.resolve(__dirname, '../exporter/src/index.ts')
    }
  }
});
