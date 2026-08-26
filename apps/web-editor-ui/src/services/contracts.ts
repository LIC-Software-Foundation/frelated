import type { Collaborator, User } from '@frelated/types';
import type { CompilationState, ProjectFile, ProjectWithFiles } from '../types';
import type { LoginPayload, RegisterPayload } from './auth.types';
import type { ProjectImportResult } from './project.types';

export interface AuthServiceContract {
  getSessionUser: () => User | null;
  restoreSession: () => Promise<User | null>;
  login: (payload: LoginPayload) => Promise<User>;
  register: (payload: RegisterPayload) => Promise<User>;
  logout: () => void;
}

export interface ProjectsServiceContract {
  listProjects: (ownerEmail: string) => Promise<ProjectWithFiles[]>;
  getSharedProject: (
    ownerEmail: string,
    projectId: string,
  ) => Promise<ProjectWithFiles>;
  createProject: (user: User, name: string) => Promise<ProjectWithFiles>;
  importProject: (
    user: User,
    name: string,
    result: ProjectImportResult,
  ) => Promise<ProjectWithFiles>;
  deleteProject: (ownerEmail: string, projectId: string) => Promise<void>;
  renameProject: (
    ownerEmail: string,
    projectId: string,
    name: string,
  ) => Promise<ProjectWithFiles | undefined>;
  markProjectAsOpened: (
    ownerEmail: string,
    projectId: string,
  ) => Promise<ProjectWithFiles | undefined>;
  updateFileContent: (
    projectId: string,
    fileId: string,
    content: string,
  ) => Promise<void>;
  replaceProjectFiles: (
    ownerEmail: string,
    projectId: string,
    files: ProjectFile[],
  ) => Promise<ProjectWithFiles | undefined>;
  replaceProjectCollaborators: (
    ownerEmail: string,
    projectId: string,
    collaborators: Collaborator[],
  ) => Promise<ProjectWithFiles | undefined>;
  approveCollaborator: (
    projectId: string,
    collaboratorId: string,
  ) => Promise<ProjectWithFiles | undefined>;
  removeCollaborator: (
    projectId: string,
    collaboratorId: string,
  ) => Promise<ProjectWithFiles | undefined>;
}

export interface CompilationServiceContract {
  compileProject: (projectId: string) => Promise<CompilationState>;
}

export interface AppServices {
  auth: AuthServiceContract;
  projects: ProjectsServiceContract;
  compilation: CompilationServiceContract;
}
