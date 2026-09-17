import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';
import type { ProjectFile } from '../domain/models';

export const settingsSchema = z.object({
  mainFile: z.string().min(1).max(240).default('main.tex'),
  engine: z.enum(['pdflatex', 'xelatex', 'lualatex']).default('pdflatex'),
});
export type Settings = z.infer<typeof settingsSchema>;
export interface Source {
  path: string;
  content: string;
  binary: boolean;
}
export interface Snapshot {
  settings: Settings;
  sources: Source[];
}
export interface CompilationResult {
  status: 'success' | 'error';
  logs: { level: 'info' | 'warning' | 'error'; message: string }[];
  compiledAt: string;
  durationMs: number;
}

export function flattenFiles(files: ProjectFile[], parent = ''): Source[] {
  const sources: Source[] = [];
  for (const file of files) {
    // Names are single path components; never allow traversal or TeX options.
    if (
      !file.name ||
      file.name === '.' ||
      file.name === '..' ||
      !/^[\p{L}\p{N}_. -]+$/u.test(file.name) ||
      file.name.startsWith('-')
    ) {
      throw new Error('Nom de fichier non autorisé pour la compilation.');
    }
    const name = parent ? `${parent}/${file.name}` : file.name;
    if (name === 'output' || name.startsWith('output/'))
      throw new Error('Le dossier output est réservé au compilateur.');
    if (file.type === 'folder')
      sources.push(...flattenFiles(file.children ?? [], name));
    else {
      const content = file.content ?? '';
      const binary = /^data:[^;]+;base64,/u.test(content);
      sources.push({
        path: name,
        content: binary ? content.slice(content.indexOf(',') + 1) : content,
        binary,
      });
    }
  }
  return sources;
}

export function makeSnapshot(
  files: ProjectFile[],
  settings: Settings,
): Snapshot {
  const sources = flattenFiles(files).sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  if (
    sources.length > 500 ||
    Buffer.byteLength(JSON.stringify(sources)) > 20 * 1024 * 1024
  ) {
    throw new Error('Projet trop volumineux (500 fichiers ou 20 Mo maximum).');
  }
  if (new Set(sources.map((f) => f.path)).size !== sources.length)
    throw new Error('Chemins de fichiers dupliqués.');
  if (
    posix.normalize(settings.mainFile) !== settings.mainFile ||
    !sources.some((f) => f.path === settings.mainFile && !f.binary) ||
    !settings.mainFile.endsWith('.tex')
  ) {
    throw new Error('Sélectionnez un fichier principal .tex existant.');
  }
  if (
    !sources.find((source) => source.path === settings.mainFile)?.content.trim()
  ) {
    throw new Error(
      `Le fichier principal « ${settings.mainFile} » est vide. Enregistrez son contenu avant de compiler.`,
    );
  }
  return { sources, settings };
}
export const fingerprint = (snapshot: Snapshot) =>
  createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
