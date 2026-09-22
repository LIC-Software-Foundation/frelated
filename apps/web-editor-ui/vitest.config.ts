import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@frelated/types': resolve(
        __dirname,
        '../../packages/types/src/index.ts',
      ),
    },
  },
  test: {
    environment: 'jsdom',
    include: [
      'tests/compilation*.test.tsx',
      'tests/proofreading*.test.ts',
      'tests/pdf-sync*.test.ts',
      'tests/guest-access*.test.tsx',
      'tests/toast*.test.tsx',
    ],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
