/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVICE_MODE?: 'api' | 'mock';
  readonly VITE_PROJECTS_API_URL?: string;
  readonly VITE_PROJECTS_API_PROXY_TARGET?: string;
  readonly VITE_COLLAB_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
