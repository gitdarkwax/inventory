import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Match the "@/*" path alias from tsconfig.json so route files can be tested.
    alias: { '@': path.resolve(__dirname) },
  },
});
