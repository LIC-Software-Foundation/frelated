import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const apiProxyTarget =
    env.VITE_PROJECTS_API_PROXY_TARGET?.trim() || 'http://localhost:3000';

  return {
    resolve: {
      alias: {
        '@frelated/types': resolve(
          __dirname,
          '../../packages/types/src/index.ts',
        ),
      },
    },
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  };
});
