import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  // Tailwind only for the shadcn demo's stylesheet (shadcn.css); no other page uses it.
  plugins: [react({ compiler: true }), tailwindcss()],
  // fieldspec's own entry points, as the example renderers import them, resolve to source: one copy of each module.
  resolve: { conditions: ['fieldspec@dev', ...defaultClientConditions] },
  // Relative asset paths, so the built page works from any folder (GitHub Pages, say).
  base: './',
  server: { port: 4193, strictPort: true },
  build: {
    rollupOptions: {
      input: { main: page('index.html'), tutorial: page('tutorial.html'), models: page('models.html'), examples: page('examples.html') },
    },
  },
});
