import { randomUUID } from 'node:crypto';
import { removeCompilation } from '../compilation/queue';
import { z } from 'zod';
import { env } from '../config/env';
import { createSeedStore } from '../data/seed';
import type {
  ApiUser,
  AppNotificationRecord,
  AuthPrincipal,
  GuestPrincipal,
  ProjectCollaborator,
  ProjectFile,
  ProjectRecord,
} from '../domain/models';
import {
  mongoStore,
  type MongoProjectRecord,
} from '../repositories/mongoStore';
import { toStoredAcl, type StoredFileIndexNode } from './fileStore';
import { assertProjectParticipantCapacity } from './projectCapacity';

const notifyOwner = async (
  ownerEmail: string,
  notification: Omit<AppNotificationRecord, 'recipientEmail' | 'read'>,
): Promise<void> => {
  const persistedNotification: AppNotificationRecord = {
    ...notification,
    recipientEmail: ownerEmail.trim().toLowerCase(),
    read: false,
  };
  await mongoStore.insertNotification(persistedNotification);
  void fetch(`${env.collabServerUrl}/internal/notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sync-secret': env.authSecret,
    },
    body: JSON.stringify({
      recipientEmail: ownerEmail,
      notification: persistedNotification,
    }),
  }).catch(() => {
    // Non-blocking: a notification failure must not block the main request.
  });
};

const projectFileSchema: z.ZodType<ProjectFile> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string().min(1),
    type: z.enum(['tex', 'bib', 'folder', 'image']),
    content: z.string().optional(),
    children: z.array(projectFileSchema).optional(),
    createdAt: z.string(),
  }),
);

const collaboratorSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(['viewer', 'editor', 'owner']).default('editor'),
  isOnline: z.boolean().optional(),
  status: z.enum(['pending', 'approved']).optional(),
});

const createProjectSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  files: z.array(projectFileSchema).optional(),
  imported: z.boolean().optional(),
  hasTexFile: z.boolean().optional(),
});

const renameProjectSchema = z.object({
  name: z.string().trim().min(1),
});

const updateFilesSchema = z.object({
  files: z.array(projectFileSchema),
});

const updateCollaboratorsSchema = z.object({
  collaborators: z.array(collaboratorSchema),
});

const accessSharedProjectSchema = z.object({
  ownerEmail: z.string().email(),
  projectId: z.string(),
});

const defaultFiles = (): ProjectFile[] => [
  {
    id: randomUUID(),
    name: 'main.tex',
    type: 'tex',
    content: `\\documentclass{article}\n\\usepackage{lmodern}\n\\usepackage[T1]{fontenc}\n\\usepackage[utf8]{inputenc}\n\\begin{document}\nVotre contenu ici.\n\\end{document}\n`,
    createdAt: new Date().toISOString(),
  },
  {
    id: randomUUID(),
    name: 'references.bib',
    type: 'bib',
    content: '',
    createdAt: new Date().toISOString(),
  },
  {
    id: randomUUID(),
    name: 'figures',
    type: 'folder',
    children: [],
    createdAt: new Date().toISOString(),
  },
];

const normalizeEmail = (email: string) => email.trim().toLowerCase();

type CollaborationAccess = 'none' | 'viewer' | 'editor';

const notifyAccessChange = (
  projectId: string,
  email: string,
  access: CollaborationAccess,
): void => {
  fetch(`${env.collabServerUrl}/internal/access-change`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sync-secret': env.authSecret,
    },
    body: JSON.stringify({ projectId, email: normalizeEmail(email), access }),
  }).catch(() => {
    // Non-blocking: persisted ACL remains authoritative for new connections.
  });
};

const isApprovedCollaborator = (collaborator: { status?: string }) =>
  !collaborator.status || collaborator.status === 'approved';

type ProjectRequester = ApiUser | AuthPrincipal;
const isGuest = (requester: ProjectRequester): requester is GuestPrincipal =>
  'kind' in requester && requester.kind === 'guest';

const canEditProject = (
  project: ProjectRecord,
  requester: ProjectRequester,
): boolean =>
  isGuest(requester)
    ? requester.projectId === project.id
    : normalizeEmail(project.owner) === normalizeEmail(requester.email) ||
      project.collaborators.some(
        (collaborator) =>
          normalizeEmail(collaborator.email) ===
            normalizeEmail(requester.email) &&
          collaborator.role !== 'viewer' &&
          isApprovedCollaborator(collaborator),
      );

const canReadProject = (
  project: ProjectRecord,
  requester: ProjectRequester,
): boolean =>
  isGuest(requester)
    ? requester.projectId === project.id
    : normalizeEmail(project.owner) === normalizeEmail(requester.email) ||
      project.collaborators.some(
        (collaborator) =>
          normalizeEmail(collaborator.email) ===
            normalizeEmail(requester.email) &&
          isApprovedCollaborator(collaborator),
      );

const sanitizeCollaborator = (
  collaborator: ProjectCollaborator,
): ProjectCollaborator => ({
  ...collaborator,
  email: normalizeEmail(collaborator.email),
  role: collaborator.role ?? 'editor',
});

const ensureMongoProjectsConfigured = () => {
  if (!mongoStore.isEnabled()) {
    throw new Error(
      'Le stockage MongoDB des projets n est pas configure. Definis MONGODB_URL.',
    );
  }
};

const findStoredNodeById = (
  nodes: StoredFileIndexNode[],
  fileId: string,
): StoredFileIndexNode | undefined => {
  for (const node of nodes) {
    if (node.id === fileId) {
      return node;
    }
    if (node.children) {
      const found = findStoredNodeById(node.children, fileId);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
};

const ensureMongoSeedProjects = async (): Promise<void> => {
  ensureMongoProjectsConfigured();

  const hasProjects = await mongoStore.hasAnyProjects();
  if (hasProjects) {
    return;
  }

  const seedStore = createSeedStore();

  for (const project of seedStore.projects) {
    const ownerCollaborator =
      project.collaborators.find(
        (collaborator) =>
          normalizeEmail(collaborator.email) === normalizeEmail(project.owner),
      ) || project.collaborators[0];

    await mongoStore.insertProject({
      id: project.id,
      name: project.name,
      ownerId: ownerCollaborator?.id || randomUUID(),
      ownerEmail: normalizeEmail(project.owner),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      lastOpenedAt: project.lastOpenedAt,
      description: project.description,
      imported: project.imported,
      hasTexFile: project.hasTexFile,
      collaborators: toStoredAcl(
        project.collaborators.map((collaborator) =>
          sanitizeCollaborator(collaborator),
        ),
      ),
      files: project.files,
    });
  }
};

const hydrateProjectFromMongo = async (
  row: MongoProjectRecord,
): Promise<ProjectRecord> => ({
  id: row.id,
  name: row.name,
  owner: row.ownerEmail,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  lastOpenedAt: row.lastOpenedAt,
  description: row.description,
  imported: row.imported,
  hasTexFile: row.hasTexFile,
  collaborators: row.collaborators.map((collaborator) => ({
    id: collaborator.id,
    name: collaborator.name,
    email: collaborator.email,
    role: collaborator.role,
    isOnline: collaborator.isOnline,
    status: collaborator.status,
  })),
  files: await mongoStore.readProjectFiles(row.id, row.filesIndex),
});

export const projectsService = {
  async getCompilationProject(
    requester: ProjectRequester,
    projectId: string,
    edit = false,
  ): Promise<ProjectRecord> {
    ensureMongoProjectsConfigured();
    const row = await mongoStore.findProjectById(projectId);
    if (!row) throw new Error('PROJECT_NOT_FOUND');
    const project = await hydrateProjectFromMongo(row);
    if (
      !(edit
        ? canEditProject(project, requester)
        : canReadProject(project, requester))
    )
      throw new Error('FORBIDDEN');
    return project;
  },
  async listProjects(requester: ProjectRequester, ownerEmail?: string) {
    await ensureMongoSeedProjects();
    if (isGuest(requester)) {
      const row = await mongoStore.findProjectById(requester.projectId);
      return row ? [await hydrateProjectFromMongo(row)] : [];
    }
    const rows = await mongoStore.listProjects(
      normalizeEmail(requester.email),
      ownerEmail ? normalizeEmail(ownerEmail) : undefined,
    );
    return Promise.all(rows.map(hydrateProjectFromMongo));
  },

  async getSharedProject(
    requester: ApiUser,
    params: unknown,
  ): Promise<ProjectRecord> {
    await ensureMongoSeedProjects();
    const payload = accessSharedProjectSchema.parse(params);
    const row = await mongoStore.findProjectByOwnerAndId(
      normalizeEmail(payload.ownerEmail),
      payload.projectId,
    );

    if (!row) {
      throw new Error('PROJECT_NOT_FOUND');
    }

    const project = await hydrateProjectFromMongo(row);

    if (normalizeEmail(project.owner) === normalizeEmail(requester.email)) {
      return project;
    }

    const existingEntry = project.collaborators.find(
      (collaborator) =>
        normalizeEmail(collaborator.email) === normalizeEmail(requester.email),
    );

    if (existingEntry) {
      if (existingEntry.status === 'pending') {
        throw new Error('PENDING_APPROVAL');
      }
      return project;
    }

    const pendingCollaboratorId = randomUUID();
    project.collaborators.push({
      id: pendingCollaboratorId,
      name: requester.name,
      email: normalizeEmail(requester.email),
      role: 'editor',
      status: 'pending',
      isOnline: false,
    });
    project.updatedAt = new Date().toISOString();

    await mongoStore.updateProject(project.id, {
      updatedAt: project.updatedAt,
      collaborators: toStoredAcl(project.collaborators),
    });

    await notifyOwner(project.owner, {
      id: randomUUID(),
      type: 'collaboration_request',
      projectId: project.id,
      projectName: project.name,
      requesterName: requester.name,
      requesterEmail: requester.email,
      collaboratorId: pendingCollaboratorId,
      ownerEmail: project.owner,
      createdAt: new Date().toISOString(),
    });

    throw new Error('PENDING_APPROVAL');
  },

  async createProject(
    requester: ApiUser,
    input: unknown,
  ): Promise<ProjectRecord> {
    ensureMongoProjectsConfigured();
    const payload = createProjectSchema.parse(input);
    const now = new Date().toISOString();
    const project: ProjectRecord = {
      id: randomUUID(),
      name: payload.name,
      description: payload.description,
      owner: normalizeEmail(requester.email),
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      collaborators: [
        {
          id: randomUUID(),
          name: requester.name,
          email: normalizeEmail(requester.email),
          role: 'owner',
          isOnline: false,
        },
      ],
      files: payload.files?.length ? payload.files : defaultFiles(),
      imported: payload.imported,
      hasTexFile: payload.hasTexFile ?? true,
    };

    await mongoStore.insertProject({
      id: project.id,
      name: project.name,
      ownerId: requester.id,
      ownerEmail: project.owner,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      lastOpenedAt: project.lastOpenedAt,
      description: project.description,
      imported: project.imported,
      hasTexFile: project.hasTexFile,
      collaborators: toStoredAcl(project.collaborators),
      files: project.files,
    });

    return project;
  },

  async deleteProject(requester: ApiUser, projectId: string): Promise<void> {
    ensureMongoProjectsConfigured();
    const row = await mongoStore.findProjectById(projectId);

    if (!row) {
      throw new Error('PROJECT_NOT_FOUND');
    }

    if (normalizeEmail(row.ownerEmail) !== normalizeEmail(requester.email)) {
      throw new Error('FORBIDDEN');
    }

    await mongoStore.deleteProject(projectId);
    if (process.env.REDIS_URL) {
      await removeCompilation(projectId).catch((error) =>
        console.warn(
          'Nettoyage du cache de compilation différé:',
          error.message,
        ),
      );
    }
  },

  async renameProject(
    requester: ApiUser,
    projectId: string,
    input: unknown,
  ): Promise<ProjectRecord> {
    ensureMongoProjectsConfigured();
    const payload = renameProjectSchema.parse(input);
    const row = await mongoStore.findProjectById(projectId);

    if (!row) {
      throw new Error('PROJECT_NOT_FOUND');
    }

    if (normalizeEmail(row.ownerEmail) !== normalizeEmail(requester.email)) {
      throw new Error('FORBIDDEN');
    }

    const updatedAt = new Date().toISOString();
    await mongoStore.updateProject(projectId, {
      name: payload.name,
      updatedAt,
    });

    const updatedRow = await mongoStore.findProjectById(projectId);
    if (!updatedRow) {
      throw new Error('PROJECT_NOT_FOUND');
    }

    return hydrateProjectFromMongo(updatedRow);
  },

  async markProjectAsOpened(
    requester: ProjectRequester,
    projectId: string,
  ): Promise<ProjectRecord> {
    ensureMongoProjectsConfigured();
    const row = await mongoStore.findProjectById(projectId);

    if (!row) {
      throw new Error('PROJECT_NOT_FOUND');
    }

    const project = await hydrateProjectFromMongo(row);

    if (!canReadProject(project, requester)) {
      throw new Error('FORBIDDEN');
    }

    const lastOpenedAt = new Date().toISOString();
    await mongoStore.updateProject(projectId, { lastOpenedAt });
    project.lastOpenedAt = lastOpenedAt;
    return project;
  },

  async replaceProjectFiles(
    requester: ProjectRequester,
    projectId: string,
    input: unknown,
  ): Promise<ProjectRecord> {
    ensureMongoProjectsConfigured();
    const payload = updateFilesSchema.parse(input);
    const row = await mongoStore.findProjectById(projectId);

    if (!row) {
      throw new Error('PROJECT_NOT_FOUND');
    }

    const project = await hydrateProjectFromMongo(row);

    if (!canEditProject(project, requester)) {
      throw new Error('FORBIDDEN');
    }

    const updatedAt = new Date().toISOString();
    const filesIndex = await mongoStore.replaceProjectFiles(
      projectId,
      payload.files,
    );

    await mongoStore.updateProject(projectId, {
      updatedAt,
      filesIndex,
    });

    return {
      ...project,
      files: payload.files,
      updatedAt,
    };
  },

  async replaceProjectCollaborators(
    requester: ApiUser,
    projectId: string,
    input: unknown,
  ): Promise<ProjectRecord> {
    ensureMongoProjectsConfigured();
    const payload = updateCollaboratorsSchema.parse(input);
    const row = await mongoStore.findProjectById(projectId);

    if (!row) {
      throw new Error('PROJECT_NOT_FOUND');
    }

    if (normalizeEmail(row.ownerEmail) !== normalizeEmail(requester.email)) {
      throw new Error('FORBIDDEN');
    }

    const project = await hydrateProjectFromMongo(row);
    const collaborators = payload.collaborators.map((collaborator) =>
      sanitizeCollaborator(collaborator),
    );
    await assertProjectParticipantCapacity(
      row,
      collaborators.map((collaborator) => collaborator.email),
      collaborators,
    );
    const updatedAt = new Date().toISOString();

    await mongoStore.updateProject(projectId, {
      updatedAt,
      collaborators: toStoredAcl(collaborators),
    });

    const previousByEmail = new Map(
      project.collaborators.map((collaborator) => [
        normalizeEmail(collaborator.email),
        collaborator,
      ]),
    );
    const nextEmails = new Set(
      collaborators.map((collaborator) => normalizeEmail(collaborator.email)),
    );
    for (const collaborator of collaborators) {
      const email = normalizeEmail(collaborator.email);
      const previous = previousByEmail.get(email);
      if (
        isApprovedCollaborator(collaborator) &&
        (!previous ||
          previous.role !== collaborator.role ||
          previous.status !== collaborator.status)
      ) {
        notifyAccessChange(
          projectId,
          email,
          collaborator.role === 'viewer' ? 'viewer' : 'editor',
        );
      }
    }
    for (const [email] of previousByEmail) {
      if (!nextEmails.has(email)) notifyAccessChange(projectId, email, 'none');
    }

    return {
      ...project,
      collaborators,
      updatedAt,
    };
  },

  async updateFileContent(
    requester: ProjectRequester,
    projectId: string,
    fileId: string,
    content: string,
  ): Promise<void> {
    ensureMongoProjectsConfigured();
    const row = await mongoStore.findProjectById(projectId);
    if (!row) {
      throw new Error('PROJECT_NOT_FOUND');
    }

    const project = await hydrateProjectFromMongo(row);
    if (!canEditProject(project, requester)) {
      throw new Error('FORBIDDEN');
    }

    const fileNode = findStoredNodeById(row.filesIndex, fileId);
    if (!fileNode || fileNode.type === 'folder') {
      throw new Error('FILE_NOT_FOUND');
    }

    await mongoStore.updateProjectFileContent(
      projectId,
      {
        id: fileId,
        type: fileNode.type,
        createdAt: fileNode.createdAt,
      },
      content,
    );
    await mongoStore.updateProject(projectId, {
      updatedAt: new Date().toISOString(),
    });
  },

  async approveCollaborator(
    requester: ApiUser,
    projectId: string,
    collaboratorId: string,
  ): Promise<ProjectRecord> {
    ensureMongoProjectsConfigured();
    const row = await mongoStore.findProjectById(projectId);
    if (!row) {
      throw new Error('PROJECT_NOT_FOUND');
    }
    if (normalizeEmail(row.ownerEmail) !== normalizeEmail(requester.email)) {
      throw new Error('FORBIDDEN');
    }

    const collaboratorToApprove = row.collaborators.find(
      (collaborator) => collaborator.id === collaboratorId,
    );
    if (!collaboratorToApprove) {
      throw new Error('COLLABORATOR_NOT_FOUND');
    }
    await assertProjectParticipantCapacity(row, collaboratorToApprove.email);

    const approved = await mongoStore.approveProjectCollaborator(
      projectId,
      collaboratorId,
    );
    if (!approved) {
      throw new Error('COLLABORATOR_NOT_FOUND');
    }

    const updatedAt = new Date().toISOString();
    await mongoStore.updateProject(projectId, { updatedAt });

    const updatedRow = await mongoStore.findProjectById(projectId);
    if (!updatedRow) {
      throw new Error('PROJECT_NOT_FOUND');
    }
    const updatedProject = await hydrateProjectFromMongo(updatedRow);
    const collaborator = updatedProject.collaborators.find(
      (entry) => entry.id === collaboratorId,
    );
    if (collaborator) {
      notifyAccessChange(
        projectId,
        collaborator.email,
        collaborator.role === 'viewer' ? 'viewer' : 'editor',
      );
    }
    return updatedProject;
  },

  async removeCollaborator(
    requester: ApiUser,
    projectId: string,
    collaboratorId: string,
  ): Promise<ProjectRecord> {
    ensureMongoProjectsConfigured();
    const row = await mongoStore.findProjectById(projectId);
    if (!row) {
      throw new Error('PROJECT_NOT_FOUND');
    }
    if (normalizeEmail(row.ownerEmail) !== normalizeEmail(requester.email)) {
      throw new Error('FORBIDDEN');
    }

    const removedCollaborator = row.collaborators.find(
      (collaborator) => collaborator.id === collaboratorId,
    );
    const deleted = await mongoStore.deleteProjectCollaborator(
      projectId,
      collaboratorId,
    );
    if (!deleted) {
      throw new Error('COLLABORATOR_NOT_FOUND');
    }

    const updatedAt = new Date().toISOString();
    await mongoStore.updateProject(projectId, { updatedAt });

    const updatedRow = await mongoStore.findProjectById(projectId);
    if (!updatedRow) {
      throw new Error('PROJECT_NOT_FOUND');
    }
    if (removedCollaborator) {
      notifyAccessChange(projectId, removedCollaborator.email, 'none');
    }
    return hydrateProjectFromMongo(updatedRow);
  },

  async getCollaborationAccess(
    projectId: string,
    email: string,
  ): Promise<CollaborationAccess> {
    ensureMongoProjectsConfigured();
    const row = await mongoStore.findProjectById(projectId);
    if (!row) return 'none';
    if (normalizeEmail(row.ownerEmail) === normalizeEmail(email)) {
      return 'editor';
    }
    const collaborator = row.collaborators.find(
      (entry) => normalizeEmail(entry.email) === normalizeEmail(email),
    );
    if (!collaborator || !isApprovedCollaborator(collaborator)) return 'none';
    return collaborator.role === 'viewer' ? 'viewer' : 'editor';
  },

  async getPrincipalCollaborationAccess(
    projectId: string,
    principal:
      | { kind: 'user'; email: string }
      | {
          kind: 'guest';
          id: string;
          email: string;
          projectId: string;
        },
  ): Promise<CollaborationAccess> {
    if (principal.kind === 'user') {
      return this.getCollaborationAccess(projectId, principal.email);
    }
    if (principal.projectId !== projectId) return 'none';
    const invitation = await mongoStore.findGuestInvitationById(principal.id);
    if (
      !invitation ||
      invitation.projectId !== projectId ||
      invitation.status !== 'active' ||
      invitation.revokedAt ||
      (invitation.expiresAt &&
        Date.parse(invitation.expiresAt) <= Date.now()) ||
      normalizeEmail(invitation.email) !== normalizeEmail(principal.email)
    ) {
      return 'none';
    }
    return 'editor';
  },

  async addApprovedCollaborator(
    requester: ApiUser,
    projectId: string,
  ): Promise<ProjectRecord> {
    ensureMongoProjectsConfigured();
    const row = await mongoStore.findProjectById(projectId);
    if (!row) throw new Error('PROJECT_NOT_FOUND');
    const project = await hydrateProjectFromMongo(row);
    if (normalizeEmail(project.owner) === normalizeEmail(requester.email)) {
      return project;
    }
    const existing = project.collaborators.find(
      (entry) =>
        normalizeEmail(entry.email) === normalizeEmail(requester.email),
    );
    if (existing && existing.status !== 'pending') {
      return project;
    }
    await assertProjectParticipantCapacity(row, requester.email);
    let collaboratorId: string;
    if (existing) {
      collaboratorId = existing.id;
      existing.name = requester.name;
      existing.role = existing.role === 'owner' ? 'owner' : 'editor';
      existing.status = 'approved';
    } else {
      collaboratorId = randomUUID();
      project.collaborators.push({
        id: collaboratorId,
        name: requester.name,
        email: normalizeEmail(requester.email),
        role: 'editor',
        status: 'approved',
        isOnline: false,
      });
    }
    project.updatedAt = new Date().toISOString();
    await mongoStore.updateProject(projectId, {
      updatedAt: project.updatedAt,
      collaborators: toStoredAcl(project.collaborators),
    });
    notifyAccessChange(projectId, requester.email, 'editor');
    await notifyOwner(project.owner, {
      id: randomUUID(),
      type: 'collaborator_joined',
      projectId: project.id,
      projectName: project.name,
      requesterName: requester.name,
      requesterEmail: normalizeEmail(requester.email),
      collaboratorId,
      ownerEmail: project.owner,
      createdAt: new Date().toISOString(),
    });
    return project;
  },

  async syncFileContent(
    projectId: string,
    fileId: string,
    content: string,
  ): Promise<void> {
    ensureMongoProjectsConfigured();
    const row = await mongoStore.findProjectById(projectId);
    if (!row) {
      return;
    }

    const fileNode = findStoredNodeById(row.filesIndex, fileId);
    if (!fileNode || fileNode.type === 'folder') {
      return;
    }

    await mongoStore.updateProjectFileContent(
      projectId,
      {
        id: fileId,
        type: fileNode.type,
        createdAt: fileNode.createdAt,
      },
      content,
    );
    await mongoStore.updateProject(projectId, {
      updatedAt: new Date().toISOString(),
    });
  },
};
