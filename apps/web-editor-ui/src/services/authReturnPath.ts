const ALLOWED_RETURN_PATHS = [
  /^\/join\/[A-Za-z0-9_-]{32,256}$/u,
  /^\/project\/[^/?#]+\/[^/?#]+$/u,
];

export const safeAuthReturnPath = (value?: string | null) => {
  if (value && ALLOWED_RETURN_PATHS.some((pattern) => pattern.test(value))) {
    return value;
  }
  return '/projects';
};

export const authPageWithReturnPath = (
  authPath: '/login' | '/register',
  returnPath: string,
) =>
  returnPath === '/projects'
    ? authPath
    : `${authPath}?returnTo=${encodeURIComponent(returnPath)}`;
