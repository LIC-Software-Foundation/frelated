import {
  getSessionUser,
  login,
  logout,
  register,
  restoreSession,
} from './authService';
import { compileProject } from './compilationService';
import { authApiService } from './api/authApiService';
import { projectsApiService } from './api/projectsApiService';
import {
  approveCollaborator as approveCollaboratorMock,
  createProject,
  deleteProject,
  importProject,
  listProjects,
  getSharedProject as getSharedProjectMock,
  markProjectAsOpened,
  removeCollaborator as removeCollaboratorMock,
  renameProject,
  replaceProjectCollaborators,
  replaceProjectFiles,
  updateFileContent as updateFileContentMock,
} from './projectService';
import type { AppServices } from './contracts';

type ServiceMode = 'mock' | 'api';

const resolveServiceMode = (): ServiceMode =>
  import.meta.env.VITE_SERVICE_MODE === 'mock' ? 'mock' : 'api';

const createMockServices = (): AppServices => ({
  auth: {
    getSessionUser,
    restoreSession,
    login,
    register,
    logout,
  },
  projects: {
    listProjects,
    getSharedProject: getSharedProjectMock,
    createProject,
    importProject,
    deleteProject,
    renameProject,
    markProjectAsOpened,
    updateFileContent: updateFileContentMock,
    replaceProjectFiles,
    replaceProjectCollaborators,
    approveCollaborator: approveCollaboratorMock,
    removeCollaborator: removeCollaboratorMock,
  },
  compilation: {
    compileProject,
  },
});

const createApiReadyServices = (): AppServices => ({
  auth: authApiService,
  projects: projectsApiService,
  compilation: {
    compileProject,
  },
});

export const appServices: AppServices =
  resolveServiceMode() === 'api'
    ? createApiReadyServices()
    : createMockServices();
