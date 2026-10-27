import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from './server.js';
import type { CompilationStore } from './store.js';

const fakeStore = {
  metrics: vi.fn(async () => ({
    queue: 'frelated-latex',
    waitingCount: 4,
    activeCount: 1,
    delayedCount: 0,
    heavyWaitingCount: 2,
    oldestWaitingJobAgeMs: 1000,
    available: true,
  })),
  readState: vi.fn(async () => ({
    status: 'idle',
    revision: 0,
    isPdfStale: false,
    logs: [],
    settings: { mainFile: 'main.tex', engine: 'pdflatex' },
  })),
  close: vi.fn(async () => {}),
} as unknown as CompilationStore;

describe('internal queue service authorization', () => {
  const apps: ReturnType<typeof buildServer>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    vi.clearAllMocks();
  });

  it('lets the autoscaler read metrics but not project compilation state', async () => {
    const app = buildServer(fakeStore);
    apps.push(app);
    const headers = {
      authorization: 'Bearer frelated-dev-autoscaler-token-change-me',
    };
    const metrics = await app.inject({
      url: '/internal/queue/metrics',
      headers,
    });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.json().waitingCount).toBe(4);

    const state = await app.inject({
      url: '/internal/compilations/project-a',
      headers,
    });
    expect(state.statusCode).toBe(401);
  });

  it('rejects unauthenticated metric requests', async () => {
    const app = buildServer(fakeStore);
    apps.push(app);
    expect(
      (await app.inject({ url: '/internal/queue/metrics' })).statusCode,
    ).toBe(401);
  });
});
