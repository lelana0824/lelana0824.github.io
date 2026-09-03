import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: '../../static/jlpt-max-deck',
    emptyOutDir: true,
    sourcemap: false,
  },
});
