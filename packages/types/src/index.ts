// Common user type
export interface User {
  id: string;
  name: string;
  email: string;
  joinedAt: string;
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
}

export interface AppNotification {
  id: string;
  type: 'collaboration_request';
  read: boolean;
  createdAt: string;
  projectId: string;
  projectName: string;
  requesterName: string;
  requesterEmail: string;
  collaboratorId: string;
  ownerEmail: string;
}
