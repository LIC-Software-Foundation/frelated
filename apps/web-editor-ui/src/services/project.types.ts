import type { ProjectFile } from '../types';

export interface ProjectImportResult {
  files: ProjectFile[];
  hasTexFile: boolean;
  mainTexId?: string;
}
