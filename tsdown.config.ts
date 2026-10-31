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
  inputOptions: {
    // src/react/index.tsx opens with 'use no memo', and its entry keeps it: the warning that it may not is moot.
    onLog(level, log, handler) {
      if (log.code !== 'MODULE_LEVEL_DIRECTIVE') handler(level, log);
    },
  },
});
