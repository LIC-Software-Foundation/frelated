import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Snapshot } from './model';

export interface SyncArtifact {
  jobId: string;
  pdf: string;
  synctex: string;
  snapshot: Snapshot;
  hash: string;
  stale: boolean;
}

export const findSyncSource = (snapshot: Snapshot, requested: string) => {
  const normalized = requested.replace(/\\/gu, '/');
  if (
    path.posix.normalize(normalized) !== normalized ||
    normalized.startsWith('/') ||
    normalized.startsWith('-')
  ) {
    throw new Error('INVALID_SYNC_PATH');
  }
  const source = snapshot.sources.find(
    (entry) => entry.path === normalized && !entry.binary,
  );
  if (!source) throw new Error('SYNC_SOURCE_NOT_FOUND');
  return source;
};

const runSyncTeX = (args: string[], cwd: string) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn('synctex', args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8' },
    });
    let output = '';
    let errorOutput = '';
    const append = (current: string, data: Buffer) =>
      (current + data.toString()).slice(-64 * 1024);
    child.stdout.on('data', (data: Buffer) => {
      output = append(output, data);
    });
    child.stderr.on('data', (data: Buffer) => {
      errorOutput = append(errorOutput, data);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && output.includes('SyncTeX result begin'))
        resolve(output);
      else reject(new Error(`SYNCTEX_FAILED:${errorOutput.slice(-300)}`));
    });
  });

export const parseSyncTexFields = (output: string) => {
  const fields = new Map<string, string>();
  for (const line of output.split(/\r?\n/u)) {
    const separator = line.indexOf(':');
    if (separator > 0 && !fields.has(line.slice(0, separator))) {
      fields.set(line.slice(0, separator), line.slice(separator + 1).trim());
    }
  }
  return fields;
};

const finite = (value: string | undefined, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const sourceSearchCandidates = (
  source: string,
  position: { line: number; column: number },
) => {
  const maximumLine = Math.max(1, source.split(/\r?\n/u).length);
  const line = Math.min(position.line, maximumLine);
  const candidates = [
    { line, column: Math.max(1, position.column + 1) },
    { line, column: 0 },
  ];
  for (let distance = 1; distance <= 3; distance += 1) {
    if (line - distance >= 1) {
      candidates.push({ line: line - distance, column: 0 });
    }
    if (line + distance <= maximumLine) {
      candidates.push({ line: line + distance, column: 0 });
    }
  }
  return candidates.filter(
    (candidate, index, all) =>
      all.findIndex(
        (entry) =>
          entry.line === candidate.line && entry.column === candidate.column,
      ) === index,
  );
};

export const pdfSearchCandidates = (position: { x: number; y: number }) => {
  const candidates = [{ x: position.x, y: position.y }];
  for (const distance of [6, 12, 24]) {
    candidates.push(
      { x: Math.max(0, position.x - distance), y: position.y },
      { x: position.x + distance, y: position.y },
      { x: position.x, y: Math.max(0, position.y - distance) },
      { x: position.x, y: position.y + distance },
    );
  }
  return candidates;
};

const withArtifact = async <T>(
  artifact: SyncArtifact,
  operation: (paths: {
    root: string;
    pdf: string;
    sources: string[];
  }) => Promise<T>,
): Promise<T> => {
  const root = await mkdtemp(path.join(tmpdir(), 'frelated-synctex-'));
  try {
    const output = path.join(root, 'output');
    await mkdir(output);
    const stem = path.basename(
      artifact.snapshot.settings.mainFile,
      path.extname(artifact.snapshot.settings.mainFile),
    );
    const pdf = path.join(output, `${stem}.pdf`);
    await Promise.all([
      writeFile(pdf, Buffer.from(artifact.pdf, 'base64')),
      writeFile(
        path.join(output, `${stem}.synctex.gz`),
        Buffer.from(artifact.synctex, 'base64'),
      ),
      ...artifact.snapshot.sources.map(async (source) => {
        const target = path.resolve(root, source.path);
        if (!target.startsWith(`${root}${path.sep}`)) {
          throw new Error('INVALID_SYNC_PATH');
        }
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(
          target,
          Buffer.from(source.content, source.binary ? 'base64' : 'utf8'),
        );
      }),
    ]);
    return await operation({
      root,
      pdf,
      sources: artifact.snapshot.sources.map((source) => source.path),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

export const sourceSearch = async (
  artifact: SyncArtifact,
  position: { file: string; line: number; column: number },
) => {
  const source = findSyncSource(artifact.snapshot, position.file);
  return withArtifact(artifact, async ({ root, pdf }) => {
    const candidates = sourceSearchCandidates(source.content, position);
    const lineWasAdjusted = candidates[0]?.line !== position.line;
    for (const [index, candidate] of candidates.entries()) {
      try {
        const output = await runSyncTeX(
          [
            'view',
            '-i',
            `${candidate.line}:${candidate.column}:${source.path}`,
            '-o',
            pdf,
          ],
          root,
        );
        const fields = parseSyncTexFields(output);
        const page = finite(fields.get('Page'));
        if (page < 1) continue;
        return {
          page,
          x: finite(fields.get('x') ?? fields.get('h')),
          y: finite(fields.get('y') ?? fields.get('v')),
          width: Math.max(1, Math.abs(finite(fields.get('W'), 12))),
          height: Math.max(1, Math.abs(finite(fields.get('H'), 12))),
          approximate: lineWasAdjusted || index > 0,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          throw error;
        }
      }
    }
    throw new Error('SYNCTEX_NO_RESULT');
  });
};

export const inverseSearch = async (
  artifact: SyncArtifact,
  position: { page: number; x: number; y: number },
) =>
  withArtifact(artifact, async ({ root, pdf, sources }) => {
    const candidates = pdfSearchCandidates(position);
    for (const [index, candidate] of candidates.entries()) {
      try {
        const output = await runSyncTeX(
          [
            'edit',
            '-o',
            `${position.page}:${candidate.x}:${candidate.y}:${pdf}`,
          ],
          root,
        );
        const fields = parseSyncTexFields(output);
        const input = fields.get('Input') || '';
        const normalizedInput = input.replace(/\\/gu, '/');
        const file = sources
          .filter((source) => !source.endsWith('/'))
          .sort((first, second) => second.length - first.length)
          .find(
            (source) =>
              normalizedInput === source ||
              normalizedInput.endsWith(`/${source}`),
          );
        const line = Math.floor(finite(fields.get('Line')));
        if (!file || line < 1) continue;
        return {
          file,
          line,
          column: Math.max(0, Math.floor(finite(fields.get('Column')))),
          approximate: index > 0,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          throw error;
        }
      }
    }
    throw new Error('SYNCTEX_NO_RESULT');
  });
