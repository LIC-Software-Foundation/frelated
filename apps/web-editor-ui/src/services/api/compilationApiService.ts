import { API_BASE_URL, apiFetch } from './http';
import { readApiSession } from './sessionStorage';
import type { CompilationSettings, CompilationState } from '../../types';
import type {
  PdfSyncSourcePosition,
  PdfSyncTargetPosition,
} from '@frelated/types';

const endpoint = (id: string) =>
  `/projects/${encodeURIComponent(id)}/compilation`;
export const compilationApiService = {
  compileProject: (id: string, onlyIfChanged = false) =>
    apiFetch<CompilationState>(endpoint(id), {
      method: 'POST',
      body: JSON.stringify({ onlyIfChanged }),
    }),
  getState: (id: string) => apiFetch<CompilationState>(endpoint(id)),
  saveSettings: (id: string, settings: CompilationSettings) =>
    apiFetch<CompilationState>(`${endpoint(id)}/settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  async fetchPdf(id: string): Promise<string> {
    const response = await fetch(`${API_BASE_URL}${endpoint(id)}/pdf`, {
      headers: { Authorization: `Bearer ${readApiSession()?.token ?? ''}` },
    });
    if (!response.ok) throw new Error('Impossible de charger le PDF.');
    return URL.createObjectURL(await response.blob());
  },
  sourceToPdf(id: string, position: PdfSyncSourcePosition, pdfJobId: string) {
    const query = new URLSearchParams({
      file: position.file,
      line: String(position.line),
      column: String(position.column ?? 0),
      pdfJobId,
    });
    return apiFetch<PdfSyncTargetPosition>(
      `${endpoint(id)}/sync/source?${query.toString()}`,
    );
  },
  pdfToSource(
    id: string,
    position: { page: number; x: number; y: number },
    pdfJobId: string,
  ) {
    const query = new URLSearchParams({
      page: String(position.page),
      x: String(position.x),
      y: String(position.y),
      pdfJobId,
    });
    return apiFetch<
      PdfSyncSourcePosition & {
        pdfJobId: string;
        stale?: boolean;
        approximate?: boolean;
      }
    >(`${endpoint(id)}/sync/pdf?${query.toString()}`);
  },
  subscribe(id: string, onState: (state: CompilationState) => void) {
    let socket: WebSocket | undefined;
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      if (closed) return;
      const url = new URL(
        `${API_BASE_URL}${endpoint(id)}/events`,
        window.location.origin,
      );
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url);
      socket.onopen = () =>
        socket?.send(JSON.stringify({ token: readApiSession()?.token ?? '' }));
      socket.onmessage = (event) => {
        try {
          onState(JSON.parse(event.data) as CompilationState);
        } catch {
          /* Ignore invalid frames. */
        }
      };
      socket.onclose = () => {
        if (!closed) timer = setTimeout(connect, 3000);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    };
  },
};
