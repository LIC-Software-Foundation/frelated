import { z } from 'zod';

export const projectIdSchema = z.string().min(1).max(128);
export const settingsSchema = z.object({
  mainFile: z.string().min(1).max(240).default('main.tex'),
  engine: z.enum(['pdflatex', 'xelatex', 'lualatex']).default('pdflatex'),
});
export const sourceSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string(),
  binary: z.boolean(),
});
export const snapshotSchema = z.object({
  settings: settingsSchema,
  sources: z.array(sourceSchema).max(500),
});
export const logSchema = z.object({
  level: z.enum(['info', 'warning', 'error']),
  message: z.string(),
});
export const resultSchema = z.object({
  status: z.enum(['success', 'error']),
  logs: z.array(logSchema),
  compiledAt: z.string(),
  durationMs: z.number().nonnegative(),
});

export type Settings = z.infer<typeof settingsSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type CompilationResult = z.infer<typeof resultSchema>;
