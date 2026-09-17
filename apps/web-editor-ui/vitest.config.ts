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
    include: ['tests/compilation*.test.tsx'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
