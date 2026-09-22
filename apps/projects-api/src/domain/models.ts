export type ProjectFileType = 'tex' | 'bib' | 'folder' | 'image';

export interface ApiUser {
  id: string;
  name: string;
  email: string;
  joinedAt: string;
}

export interface UserPrincipal {
  kind: 'user';
  userId: string;
  email: string;
  name: string;
}

export interface GuestPrincipal {
  kind: 'guest';
  guestInvitationId: string;
  projectId: string;
  email: string;
  name: string;
}

export type AuthPrincipal = UserPrincipal | GuestPrincipal;

export interface GuestInvitationRecord {
  id: string;
  projectId: string;
  email: string;
  tokenHash: string;
  role: 'editor';
  status: 'active' | 'revoked';
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
  invitedByUserId: string;
  invitedByEmail: string;
}

export interface ProjectJoinLinkRecord {
  id: string;
  projectId: string;
  tokenHash: string;
  role: 'editor';
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  createdByUserId: string;
}

export interface AppNotificationRecord {
  id: string;
  type: 'collaboration_request' | 'collaborator_joined';
  recipientEmail: string;
  read: boolean;
  createdAt: string;
  projectId: string;
  projectName: string;
  requesterName: string;
  requesterEmail: string;
  collaboratorId: string;
  ownerEmail: string;
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
