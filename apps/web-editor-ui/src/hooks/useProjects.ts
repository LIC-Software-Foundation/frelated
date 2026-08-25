import { useCallback, useEffect, useState } from 'react';
import type { Collaborator, User } from '@frelated/types';
import { ProjectFile, ProjectWithFiles } from '../types';
import { appServices } from '../services';
import { sortProjectsByActivity } from '../services/projectService';
import type { ProjectImportResult } from '../services/project.types';

export type ImportResult = ProjectImportResult;

const updateFileInTree = (
  files: ProjectFile[],
  fileId: string,
  content: string,
): ProjectFile[] =>
  files.map((f) =>
    f.id === fileId
      ? { ...f, content }
      : f.children
        ? { ...f, children: updateFileInTree(f.children, fileId, content) }
        : f,
  );

export function useProjects(user: User, ownerEmail?: string) {
  const [projects, setProjects] = useState<ProjectWithFiles[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const listOwnerFilter = ownerEmail?.trim() || '';
  const scopedOwnerEmail = ownerEmail || user.email;

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    try {
      const nextProjects =
        await appServices.projects.listProjects(listOwnerFilter);
      setProjects(nextProjects);
    } finally {
      setIsLoading(false);
    }
  }, [listOwnerFilter]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const loadSharedProject = useCallback(
    async (
      sharedOwnerEmail: string,
      projectId: string,
    ): Promise<ProjectWithFiles> => {
      const project = await appServices.projects.getSharedProject(
        sharedOwnerEmail,
        projectId,
      );

      setProjects((current) =>
        sortProjectsByActivity([
          project,
          ...current.filter((entry) => entry.id !== project.id),
        ]),
      );

      return project;
    },
    [],
  );

  const createProject = useCallback(
    async (name: string): Promise<ProjectWithFiles> => {
      const project = await appServices.projects.createProject(user, name);
      setProjects((current) => sortProjectsByActivity([project, ...current]));
      return project;
    },
    [user],
  );

  const importProject = useCallback(
    async (name: string, result: ImportResult): Promise<ProjectWithFiles> => {
      const project = await appServices.projects.importProject(
        user,
        name,
        result,
      );
      setProjects((current) => sortProjectsByActivity([project, ...current]));
      return project;
    },
    [user],
  );

  const deleteProject = useCallback(
    async (id: string): Promise<void> => {
      await appServices.projects.deleteProject(scopedOwnerEmail, id);
      setProjects((current) => current.filter((project) => project.id !== id));
    },
    [scopedOwnerEmail],
  );

  const renameProject = useCallback(
    async (id: string, name: string): Promise<ProjectWithFiles | undefined> => {
      const updatedProject = await appServices.projects.renameProject(
        scopedOwnerEmail,
        id,
        name,
      );

      if (updatedProject) {
        setProjects((current) =>
          sortProjectsByActivity(
            current.map((project) =>
              project.id === id ? updatedProject : project,
            ),
          ),
        );
      }

      return updatedProject;
    },
    [scopedOwnerEmail],
  );

  const saveFileContent = useCallback(
    async (
      projectId: string,
      fileId: string,
      content: string,
    ): Promise<void> => {
      await appServices.projects.updateFileContent(projectId, fileId, content);

      setProjects((current) =>
        current.map((project) =>
          project.id === projectId
            ? {
                ...project,
                updatedAt: new Date().toISOString(),
                files: updateFileInTree(project.files, fileId, content),
              }
            : project,
        ),
      );
    },
    [],
  );

  const updateProjectFiles = useCallback(
    async (
      id: string,
      files: ProjectFile[],
    ): Promise<ProjectWithFiles | undefined> => {
      const optimisticUpdatedAt = new Date().toISOString();

      setProjects((current) =>
        sortProjectsByActivity(
          current.map((project) =>
            project.id === id
              ? {
                  ...project,
                  files,
                  updatedAt: optimisticUpdatedAt,
                }
              : project,
          ),
        ),
      );

      const updatedProject = await appServices.projects.replaceProjectFiles(
        scopedOwnerEmail,
        id,
        files,
      );

      if (updatedProject) {
        setProjects((current) =>
          sortProjectsByActivity(
            current.map((project) =>
              project.id === id ? updatedProject : project,
            ),
          ),
        );
      }

      return updatedProject;
    },
    [scopedOwnerEmail],
  );

  const approveCollaborator = useCallback(
    async (projectId: string, collaboratorId: string): Promise<void> => {
      const updatedProject = await appServices.projects.approveCollaborator(
        projectId,
        collaboratorId,
      );

      if (updatedProject) {
        setProjects((current) =>
          current.map((project) =>
            project.id === projectId ? updatedProject : project,
          ),
        );
      }
    },
    [],
  );

  const removeCollaborator = useCallback(
    async (projectId: string, collaboratorId: string): Promise<void> => {
      const updatedProject = await appServices.projects.removeCollaborator(
        projectId,
        collaboratorId,
      );

      if (updatedProject) {
        setProjects((current) =>
          current.map((project) =>
            project.id === projectId ? updatedProject : project,
          ),
        );
      }
    },
    [],
  );

  const updateProjectCollaborators = useCallback(
    async (
      id: string,
      collaborators: Collaborator[],
    ): Promise<ProjectWithFiles | undefined> => {
      const updatedProject =
        await appServices.projects.replaceProjectCollaborators(
          scopedOwnerEmail,
          id,
          collaborators,
        );

      if (updatedProject) {
        setProjects((current) =>
          current.map((project) =>
            project.id === id ? updatedProject : project,
          ),
        );
      }

      return updatedProject;
    },
    [scopedOwnerEmail],
  );

  const openProject = useCallback(
    async (id: string): Promise<ProjectWithFiles | undefined> => {
      const updatedProject = await appServices.projects.markProjectAsOpened(
        scopedOwnerEmail,
        id,
      );

      if (updatedProject) {
        setProjects((current) =>
          sortProjectsByActivity(
            current.map((project) =>
              project.id === id
                ? {
                    ...project,
                    lastOpenedAt:
                      updatedProject.lastOpenedAt ?? project.lastOpenedAt,
                  }
                : project,
            ),
          ),
        );
      }

      return updatedProject;
    },
    [scopedOwnerEmail],
  );

  return {
    projects,
    isLoading,
    loadProjects,
    loadSharedProject,
    createProject,
    importProject,
    deleteProject,
    renameProject,
    openProject,
    saveFileContent,
    updateProjectFiles,
    updateProjectCollaborators,
    approveCollaborator,
    removeCollaborator,
  };
}
