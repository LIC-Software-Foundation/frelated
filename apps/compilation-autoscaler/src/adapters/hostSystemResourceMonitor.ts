import fs from 'node:fs';
import os from 'node:os';
import type {
  SystemResourceMonitor,
  SystemResources,
} from '../domain/ports.js';
import type { Logger } from '../logging/logger.js';

const PROC_MEMINFO_PATH = '/proc/meminfo';

/**
 * Parses `/proc/meminfo` into a map of field name -> value in bytes.
 * Docker does not virtualize this file per-container (no LXCFS): reading
 * it from inside an ordinary container reports the real HOST totals, which
 * is exactly what a single-machine autoscaler needs to reason about actual
 * spare capacity, as opposed to `os.totalmem()`/`os.freemem()`, which are
 * backed by the same file on Linux but only expose `MemFree` — not
 * `MemAvailable`, which additionally counts reclaimable page cache as
 * available. Using `MemFree` alone chronically under-reports free memory on
 * any host with a warm cache, which would cause needless refusals to scale
 * up.
 */
function parseMemInfo(content: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const line of content.split('\n')) {
    const match = /^(\w+):\s+(\d+)\s*kB$/.exec(line.trim());
    if (match) result[match[1]] = Number(match[2]) * 1024;
  }
  return result;
}

/**
 * Reads host resources straight from `/proc` when available (any Linux
 * host or Linux container, which is how this service always runs in
 * practice — see docker-compose.yml), falling back to Node's portable
 * `os` module otherwise (native/non-Linux development only). Implements
 * `SystemResourceMonitor`; nothing outside this file knows how the numbers
 * were obtained.
 */
export class HostSystemResourceMonitor implements SystemResourceMonitor {
  private warnedAboutFallback = false;

  constructor(private readonly logger: Logger) {}

  async getResources(): Promise<SystemResources> {
    const cpuCount = Math.max(1, os.cpus().length);
    const loadAverage1m = os.loadavg()[0] ?? 0;
    const cpuLoadFraction = loadAverage1m / cpuCount;

    if (fs.existsSync(PROC_MEMINFO_PATH)) {
      try {
        const meminfo = parseMemInfo(
          fs.readFileSync(PROC_MEMINFO_PATH, 'utf8'),
        );
        const totalMemoryBytes = meminfo.MemTotal ?? os.totalmem();
        // MemAvailable (kernel-estimated, cache-aware) beats MemFree.
        const availableMemoryBytes =
          meminfo.MemAvailable ?? meminfo.MemFree ?? os.freemem();
        return {
          totalMemoryBytes,
          availableMemoryBytes,
          cpuCount,
          cpuLoadFraction,
        };
      } catch (error) {
        this.logger.warn(
          `failed to read ${PROC_MEMINFO_PATH}, falling back to os module: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (!this.warnedAboutFallback) {
      this.warnedAboutFallback = true;
      this.logger.warn(
        `${PROC_MEMINFO_PATH} unavailable on this platform; falling back to os.totalmem()/os.freemem() (less accurate: counts reclaimable cache as used) and, on non-Linux hosts, a CPU load of 0 since os.loadavg() is unsupported there`,
      );
    }
    return {
      totalMemoryBytes: os.totalmem(),
      availableMemoryBytes: os.freemem(),
      cpuCount,
      cpuLoadFraction,
    };
  }
}
