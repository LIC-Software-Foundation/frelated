import { env } from '../config/env';
import type { CompilationResult, Settings, Snapshot } from './model';
import type { SyncArtifact } from './synctex';

export interface CompilationState
  extends Omit<Partial<CompilationResult>, 'status'> {
  status: 'idle' | 'compiling' | 'success' | 'error';
  jobId?: string;
  revision: number;
  pdfJobId?: string;
  synctexJobId?: string;
  isPdfStale: boolean;
  settings: Settings;
}

class CompilationQueueClient {
  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      env.compilationServiceTimeoutMs,
    );
    try {
      const response = await fetch(`${env.compilationServiceUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${env.compilationProjectsApiToken}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        const error = new Error(
          body.message || `QUEUE_SERVICE_${response.status}`,
        );
        Object.assign(error, { statusCode: response.status });
        throw error;
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  async state(projectId: string): Promise<CompilationState> {
    return (
      await this.request(
        `/internal/compilations/${encodeURIComponent(projectId)}`,
      )
    ).json() as Promise<CompilationState>;
  }

  async settings(
    projectId: string,
    settings: Settings,
  ): Promise<CompilationState> {
    return (
      await this.request(
        `/internal/compilations/${encodeURIComponent(projectId)}/settings`,
        { method: 'PUT', body: JSON.stringify(settings) },
      )
    ).json() as Promise<CompilationState>;
  }

  async submit(input: {
    projectId: string;
    hash: string;
    snapshot: Snapshot;
    onlyIfChanged: boolean;
  }): Promise<{ state: CompilationState; accepted: boolean }> {
    const response = await this.request('/internal/compilations', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return {
      state: (await response.json()) as CompilationState,
      accepted: response.status === 202,
    };
  }

  async pdf(projectId: string): Promise<Buffer> {
    const response = await this.request(
      `/internal/compilations/${encodeURIComponent(projectId)}/pdf`,
    );
    return Buffer.from(await response.arrayBuffer());
  }

  async syncArtifact(projectId: string): Promise<SyncArtifact | null> {
    try {
      return (
        await this.request(
          `/internal/compilations/${encodeURIComponent(projectId)}/sync-artifact`,
        )
      ).json() as Promise<SyncArtifact>;
    } catch (error) {
      if (
        error instanceof Error &&
        'statusCode' in error &&
        error.statusCode === 404
      ) {
        return null;
      }
      throw error;
    }
  }

  async remove(projectId: string): Promise<void> {
    await this.request(
      `/internal/compilations/${encodeURIComponent(projectId)}`,
      { method: 'DELETE' },
    );
  }
}

export const compilationQueueClient = new CompilationQueueClient();
