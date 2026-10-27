import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpQueueDepthProvider } from './httpQueueDepthProvider.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe('HttpQueueDepthProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads only the queue snapshot needed by the scaling policy', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            waitingCount: 5,
            heavyWaitingCount: 2,
            activeCount: 3,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new HttpQueueDepthProvider(
      'http://queue-service:3200',
      'autoscaler-token',
      1000,
      logger,
    );
    await expect(provider.getQueueSnapshot()).resolves.toEqual({
      waitingCount: 5,
      heavyWaitingCount: 2,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://queue-service:3200/internal/queue/metrics',
      expect.objectContaining({
        headers: { authorization: 'Bearer autoscaler-token' },
      }),
    );
  });

  it('rejects malformed metrics instead of making a wrong scaling decision', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ waitingCount: -1 }), { status: 200 }),
      ),
    );
    const provider = new HttpQueueDepthProvider(
      'http://queue-service:3200',
      'token',
      1000,
      logger,
    );
    await expect(provider.getQueueSnapshot()).rejects.toThrow(
      'invalid payload',
    );
  });
});
