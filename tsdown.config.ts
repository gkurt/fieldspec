import { defineConfig } from 'tsdown';

// One entry per export in package.json; peers (React, Zod, DialKit, React Aria) stay external.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'react/index': 'src/react/index.tsx',
    zod: 'src/zod.ts',
    dialkit: 'src/dialkit.tsx',
    'react-aria': 'src/react-aria.tsx',
  },
  format: 'esm',
  platform: 'neutral',
  dts: true,
  sourcemap: true,
});
