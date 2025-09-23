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
  name?: string;
  email?: string;
  role?: 'viewer' | 'editor';
  isOnline?: boolean;
}
