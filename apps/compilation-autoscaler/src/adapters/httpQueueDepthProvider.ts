import type { QueueDepthProvider, QueueSnapshot } from '../domain/ports.js';
import type { Logger } from '../logging/logger.js';

export class HttpQueueDepthProvider implements QueueDepthProvider {
  constructor(
    private readonly serviceUrl: string,
    private readonly token: string,
    private readonly timeoutMs: number,
    private readonly logger: Logger,
  ) {}

  async getQueueSnapshot(): Promise<QueueSnapshot> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(
        `${this.serviceUrl}/internal/queue/metrics`,
        {
          signal: controller.signal,
          headers: { authorization: `Bearer ${this.token}` },
        },
      );
      if (!response.ok) {
        throw new Error(`queue metrics API returned ${response.status}`);
      }
      const value = (await response.json()) as Record<string, unknown>;
      if (
        typeof value.waitingCount !== 'number' ||
        !Number.isInteger(value.waitingCount) ||
        value.waitingCount < 0 ||
        typeof value.heavyWaitingCount !== 'number' ||
        !Number.isInteger(value.heavyWaitingCount) ||
        value.heavyWaitingCount < 0
      ) {
        throw new Error('queue metrics API returned an invalid payload');
      }
      return {
        waitingCount: value.waitingCount,
        heavyWaitingCount: value.heavyWaitingCount,
      };
    } catch (error) {
      this.logger.error('queue metrics request failed', error);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async close(): Promise<void> {
    // No persistent connection is owned by the native fetch client.
  }
}
