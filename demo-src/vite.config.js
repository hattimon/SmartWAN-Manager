import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: currentDir,
  base: '/SmartWAN-Manager/demo/',
  publicDir: path.resolve(currentDir, '../public'),
  plugins: [react()],
  build: {
    outDir: path.resolve(currentDir, '../docs/demo'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
