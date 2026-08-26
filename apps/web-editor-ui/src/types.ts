export type FileKind = 'tex' | 'bib' | 'folder' | 'image';

export type CollaboratorWithColor = import('@frelated/types').Collaborator & {
  color: string;
  colorLight?: string;
};

export interface ProjectFile {
  id: string;
  name: string;
  type: FileKind;
  content?: string;
  children?: ProjectFile[];
  createdAt: string;
}

export interface ProjectWithFiles {
  id: string;
  name: string;
  owner: string;
  createdAt: string;
  updatedAt?: string;
  lastOpenedAt?: string;
  description?: string;
  collaborators: import('@frelated/types').Collaborator[];
  files: ProjectFile[];
  imported?: boolean;
  hasTexFile?: boolean;
}

export type CompilationStatus = 'idle' | 'compiling' | 'success' | 'error';
export type LogLevel = 'info' | 'warning' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  line?: number;
  file?: string;
}

export interface CompilationState {
  status: CompilationStatus;
  pdfUrl?: string;
  logs: LogEntry[];
  compiledAt?: string;
  durationMs?: number;
}
