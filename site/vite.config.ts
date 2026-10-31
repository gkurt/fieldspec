import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  plugins: [react({ compiler: true })],
  // Relative asset paths, so the built page works from any folder (GitHub Pages, say).
  base: './',
  server: { port: 4193, strictPort: true },
  build: { rollupOptions: { input: { main: page('index.html'), tutorial: page('tutorial.html'), models: page('models.html') } } },
});
