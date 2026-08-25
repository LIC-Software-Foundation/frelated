export type ProjectFileType = 'tex' | 'bib' | 'folder' | 'image';

export interface ApiUser {
  id: string;
  name: string;
  email: string;
  joinedAt: string;
}

export interface StoredUser extends ApiUser {
  passwordHash: string;
  passwordSalt: string;
  organization?: string;
}

export interface ProjectCollaborator {
  id: string;
  name: string;
  email: string;
  role: 'viewer' | 'editor' | 'owner';
  isOnline?: boolean;
  status?: 'pending' | 'approved';
}

export interface ProjectFile {
  id: string;
  name: string;
  type: ProjectFileType;
  content?: string;
  children?: ProjectFile[];
  createdAt: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  owner: string;
  createdAt: string;
  updatedAt?: string;
  lastOpenedAt?: string;
  description?: string;
  collaborators: ProjectCollaborator[];
  files: ProjectFile[];
  imported?: boolean;
  hasTexFile?: boolean;
}

export interface DataStoreShape {
  users: StoredUser[];
  projects: ProjectRecord[];
}

export interface AuthSession {
  token: string;
  user: ApiUser;
}
