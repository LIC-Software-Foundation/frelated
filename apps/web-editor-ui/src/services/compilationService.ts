import { SUCCESS_LOGS, ERROR_LOGS } from '../data/compilation';
import { CompilationState } from '../types';

const delay = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

export async function compileProject(
  projectId: string,
): Promise<CompilationState> {
  const start = Date.now();
  const baseDelay = projectId ? 1800 : 1200;
  await delay(baseDelay + Math.random() * 1200);

  const success = Math.random() > 0.3;

  return {
    status: success ? 'success' : 'error',
    pdfUrl: undefined,
    logs: success ? SUCCESS_LOGS : ERROR_LOGS,
    compiledAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  };
}
