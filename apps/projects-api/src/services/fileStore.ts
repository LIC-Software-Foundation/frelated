import type { ProjectCollaborator, ProjectFile } from '../domain/models';

interface StoredFileIndexNode {
  id: string;
  name: string;
  type: ProjectFile['type'];
  createdAt: string;
  relativePath?: string;
  mimeType?: string;
  children?: StoredFileIndexNode[];
}

export const toStoredAcl = (collaborators: ProjectCollaborator[]) =>
  collaborators.map((collaborator) => ({
    ...collaborator,
    canRead:
      collaborator.role === 'viewer' ||
      collaborator.role === 'editor' ||
      collaborator.role === 'owner',
    canWrite: collaborator.role === 'editor' || collaborator.role === 'owner',
  }));

export type { StoredFileIndexNode };
