import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  plugins: [react({ compiler: true })],
  // fieldspec's own entry points, as the example renderers import them, resolve to source: one copy of each module.
  resolve: { conditions: ['fieldspec@dev', ...defaultClientConditions] },
  server: { port: 4192, strictPort: true },
});
