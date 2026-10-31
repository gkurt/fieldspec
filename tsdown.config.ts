import { defineConfig } from 'tsdown';

// One entry per export in package.json; peers (React, Zod) stay external.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'react/index': 'src/react/index.tsx',
    zod: 'src/zod.ts',
  },
  format: 'esm',
  platform: 'neutral',
  dts: true,
  sourcemap: true,
});
