import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const buildNumber = (() => { try { return fs.readFileSync(path.resolve(__dirname, '../build.txt'), 'utf-8').trim(); } catch { return '0'; } })();
const appVersion = fs.readFileSync(path.resolve(__dirname, '../VERSION'), 'utf-8').trim();
const openclawCompat = fs.readFileSync(path.resolve(__dirname, '../OPENCLAW_COMPAT'), 'utf-8').trim();

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:18791',
        ws: true,
      },
    },
  },
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD_NUMBER__: JSON.stringify(buildNumber),
    __APP_VERSION__: JSON.stringify(appVersion),
    __OPENCLAW_COMPAT__: JSON.stringify(openclawCompat),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  },
  build: {
    outDir: path.resolve(__dirname, '../internal/web/dist'),
    emptyOutDir: true,
  },
});
