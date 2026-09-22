// Common user type
export interface User {
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
export type EditorIdentity = User | GuestPrincipal;

export type ProjectCapability =
  | 'READ'
  | 'EDIT_CONTENT'
  | 'MANAGE_FILES'
  | 'COMPILE'
  | 'PDF_SYNC'
  | 'MANAGE_COLLABORATORS'
  | 'MANAGE_GUESTS'
  | 'DELETE_PROJECT';

export interface ProjectAccess {
  role: 'owner' | 'editor' | 'viewer';
  capabilities: ProjectCapability[];
}

export type GuestInvitationStatus = 'active' | 'revoked' | 'expired';

export interface GuestInvitation {
  id: string;
  projectId: string;
  email: string;
  role: 'editor';
  status: GuestInvitationStatus;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
  invitedByUserId: string;
  invitedByEmail: string;
}

export interface ProofreadingSuggestion {
  value: string;
}

export interface ProofreadingIssue {
  offset: number;
  length: number;
  message: string;
  shortMessage?: string;
  ruleId?: string;
  category?: string;
  type: 'spelling' | 'grammar' | 'typography' | 'style' | 'other';
  suggestions: ProofreadingSuggestion[];
}

export interface ProofreadingCheckResponse {
  language: string;
  issues: ProofreadingIssue[];
}

export interface PdfSyncSourcePosition {
  file: string;
  line: number;
  column?: number;
}

export interface PdfSyncTargetPosition {
  pdfJobId: string;
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  stale?: boolean;
  approximate?: boolean;
}

// Shape of data from UserForm
export interface UserFormData {
  name: string;
  email: string;
}

export interface Project {
  id: string;
  name: string;
  files: string[];
  collaborators: User[];
  owner: string;
  createdAt: string;
}

export interface Collaborator {
  id?: string;
  name?: string;
  email?: string;
  role?: 'viewer' | 'editor';
  isOnline?: boolean;
  status?: 'pending' | 'approved';
  kind?: 'user' | 'guest';
  guestInvitationId?: string;
}

export interface AppNotification {
  id: string;
  type: 'collaboration_request' | 'collaborator_joined';
  read: boolean;
  createdAt: string;
  projectId: string;
  projectName: string;
  requesterName: string;
  requesterEmail: string;
  collaboratorId: string;
  ownerEmail: string;
}
