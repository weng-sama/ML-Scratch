import { cpSync } from 'node:fs';
import { defineConfig } from 'vite';

// Electron 以 file:// 載入 dist，所以資源路徑要用相對路徑
export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 3000 },
  plugins: [{
    name: 'copy-blockly-media',
    writeBundle() { cpSync('node_modules/blockly/media', 'dist/media', { recursive: true }); },
  }],
});
