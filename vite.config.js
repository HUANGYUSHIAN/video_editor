import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  /** 勿預打包 @ffmpeg/ffmpeg，否則 Worker 會指向不存在的 .vite/deps/worker.js */
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
});
