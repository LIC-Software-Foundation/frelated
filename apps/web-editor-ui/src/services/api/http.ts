import { clearApiSession, readApiSession } from './sessionStorage';

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

const API_BASE_URL = normalizeBaseUrl(
  import.meta.env.VITE_PROJECTS_API_URL?.trim() || '/api',
);

interface ApiFetchOptions extends RequestInit {
  authenticated?: boolean;
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  const session = readApiSession();
  const hasJsonBody =
    typeof options.body === 'string' && options.body.trim().length > 0;

  if (hasJsonBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (options.authenticated !== false && session?.token) {
    headers.set('Authorization', `Bearer ${session.token}`);
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Impossible de joindre l'API Frelated: ${error.message}`
        : "Impossible de joindre l'API Frelated.",
    );
  }

  if (response.status === 401) {
    clearApiSession();
    // Notify the app immediately so the user is redirected to login
    // without needing to refresh manually.
    window.dispatchEvent(new Event('frelated:session-expired'));
  }

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(errorBody?.message || 'Requete API echouee.');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
