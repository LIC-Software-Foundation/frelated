import type { Collaborator, User } from '@frelated/types';
import type { ProjectsServiceContract } from '../contracts';
import type { ProjectImportResult } from '../project.types';
import type { ProjectFile, ProjectWithFiles } from '../../types';
import { apiFetch } from './http';

interface ProjectEnvelope {
  project: ProjectWithFiles;
}

interface ProjectsEnvelope {
  projects: ProjectWithFiles[];
}

export const projectsApiService: ProjectsServiceContract = {
  async listProjects(ownerEmail: string) {
    const params = new URLSearchParams();
    if (ownerEmail) {
      params.set('ownerEmail', ownerEmail);
    }

    const response = await apiFetch<ProjectsEnvelope>(
      `/projects?${params.toString()}`,
    );
    return response.projects;
  },

  async getSharedProject(ownerEmail: string, projectId: string) {
    const response = await apiFetch<ProjectEnvelope>(
      `/projects/shared/${encodeURIComponent(ownerEmail)}/${encodeURIComponent(projectId)}`,
    );
    return response.project;
  },

  async createProject(_user: User, name: string) {
    const response = await apiFetch<ProjectEnvelope>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    return response.project;
  },

  async importProject(_user: User, name: string, result: ProjectImportResult) {
    const response = await apiFetch<ProjectEnvelope>('/projects', {
      method: 'POST',
      body: JSON.stringify({
        name,
        files: result.files,
        imported: true,
        hasTexFile: result.hasTexFile,
      }),
    });
    return response.project;
  },

  async deleteProject(_ownerEmail: string, projectId: string) {
    await apiFetch<void>(`/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
    });
  },

  async renameProject(_ownerEmail: string, projectId: string, name: string) {
    const response = await apiFetch<ProjectEnvelope>(
      `/projects/${encodeURIComponent(projectId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      },
    );
    return response.project;
  },

  async markProjectAsOpened(_ownerEmail: string, projectId: string) {
    const response = await apiFetch<ProjectEnvelope>(
      `/projects/${encodeURIComponent(projectId)}/open`,
      {
        method: 'POST',
      },
    );
    return response.project;
  },

  async updateFileContent(projectId: string, fileId: string, content: string) {
    await apiFetch<void>(
      `/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ content }),
      },
    );
  },

  async replaceProjectFiles(
    _ownerEmail: string,
    projectId: string,
    files: ProjectFile[],
  ) {
    const response = await apiFetch<ProjectEnvelope>(
      `/projects/${encodeURIComponent(projectId)}/files`,
      {
        method: 'PUT',
        body: JSON.stringify({ files }),
      },
    );
    return response.project;
  },

  async approveCollaborator(projectId: string, collaboratorId: string) {
    const response = await apiFetch<ProjectEnvelope>(
      `/projects/${encodeURIComponent(projectId)}/collaborators/${encodeURIComponent(collaboratorId)}/approve`,
      { method: 'POST' },
    );
    return response.project;
  },

  async removeCollaborator(projectId: string, collaboratorId: string) {
    const response = await apiFetch<ProjectEnvelope>(
      `/projects/${encodeURIComponent(projectId)}/collaborators/${encodeURIComponent(collaboratorId)}`,
      { method: 'DELETE' },
    );
    return response.project;
  },

  async replaceProjectCollaborators(
    _ownerEmail: string,
    projectId: string,
    collaborators: Collaborator[],
  ) {
    const response = await apiFetch<ProjectEnvelope>(
      `/projects/${encodeURIComponent(projectId)}/collaborators`,
      {
        method: 'PUT',
        body: JSON.stringify({
          collaborators: collaborators.map((collaborator) => ({
            id: collaborator.email || collaborator.name || crypto.randomUUID(),
            name: collaborator.name || collaborator.email || 'Collaborateur',
            email: collaborator.email || '',
            role: collaborator.role || 'editor',
            isOnline: collaborator.isOnline,
          })),
        }),
      },
    );
    return response.project;
  },
};
