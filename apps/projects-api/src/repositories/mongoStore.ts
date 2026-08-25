import {
  MongoClient,
  ServerApiVersion,
  type Document,
  type Filter,
  type MongoClientOptions,
} from 'mongodb';
import { env } from '../config/env';
import type { ProjectCollaborator, ProjectFile } from '../domain/models';
import {
  decryptString,
  encryptString,
  type EncryptedValue,
} from '../services/dataProtection';
import type { StoredFileIndexNode } from '../services/fileStore';

export interface MongoProjectRecord {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail: string;
  createdAt: string;
  updatedAt?: string;
  lastOpenedAt?: string;
  description?: string;
  imported: boolean;
  hasTexFile: boolean;
  filesIndex: StoredFileIndexNode[];
  collaborators: ProjectCollaborator[];
}

interface MongoProjectDocument extends Document {
  _id: string;
  ownerId: string;
  ownerEmail: string;
  createdAt: string;
  updatedAt?: string;
  lastOpenedAt?: string;
  imported: boolean;
  hasTexFile: boolean;
  nameEncrypted: EncryptedValue;
  descriptionEncrypted?: EncryptedValue | null;
  filesIndex: StoredFileIndexNode[];
  collaborators: ProjectCollaborator[];
}

interface MongoProjectFileDocument extends Document {
  _id: string;
  projectId: string;
  fileId: string;
  type: ProjectFile['type'];
  createdAt: string;
  contentEncrypted: EncryptedValue;
}

const toProjectFileDocumentId = (projectId: string, fileId: string) =>
  `${projectId}:${fileId}`;

const sortProjectsByRecency = (projects: MongoProjectRecord[]) =>
  [...projects].sort((first, second) => {
    const firstDate =
      first.lastOpenedAt || first.updatedAt || first.createdAt || '';
    const secondDate =
      second.lastOpenedAt || second.updatedAt || second.createdAt || '';
    return secondDate.localeCompare(firstDate);
  });

const toProjectRecord = (
  document: MongoProjectDocument,
): MongoProjectRecord => ({
  id: document._id,
  name: decryptString(document.nameEncrypted, 'project', document._id, 'name'),
  ownerId: document.ownerId,
  ownerEmail: document.ownerEmail,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
  lastOpenedAt: document.lastOpenedAt,
  description: document.descriptionEncrypted
    ? decryptString(
        document.descriptionEncrypted,
        'project',
        document._id,
        'description',
      )
    : undefined,
  imported: Boolean(document.imported),
  hasTexFile: Boolean(document.hasTexFile),
  filesIndex: document.filesIndex ?? [],
  collaborators: document.collaborators ?? [],
});

const buildFilesPayload = (files: ProjectFile[]): StoredFileIndexNode[] => {
  const visit = (nodes: ProjectFile[]): StoredFileIndexNode[] =>
    nodes.map((node) => {
      if (node.type === 'folder') {
        return {
          id: node.id,
          name: node.name,
          type: node.type,
          createdAt: node.createdAt,
          children: visit(node.children ?? []),
        };
      }

      return {
        id: node.id,
        name: node.name,
        type: node.type,
        createdAt: node.createdAt,
      };
    });

  return visit(files);
};

class MongoStore {
  private client: MongoClient | null = null;
  private initialized = false;

  isEnabled(): boolean {
    return env.persistenceDriver === 'mongodb' && Boolean(env.mongodbUrl);
  }

  private getOptions(): MongoClientOptions {
    return {
      appName: 'frelated-projects-api',
      ignoreUndefined: true,
      maxPoolSize: 20,
      minPoolSize: 1,
      retryWrites: true,
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
      ...(env.mongodbDbName ? { dbName: env.mongodbDbName } : {}),
      ...(env.mongodbRequireTls ? { tls: true } : {}),
      ...(env.mongodbTlsCaFile ? { tlsCAFile: env.mongodbTlsCaFile } : {}),
    };
  }

  private async getDb() {
    if (!this.client) {
      if (!env.mongodbUrl) {
        throw new Error('MongoDB non configure.');
      }

      this.client = new MongoClient(env.mongodbUrl, this.getOptions());
      await this.client.connect();
    }

    const dbName =
      env.mongodbDbName || this.client.options.dbName || 'frelated';
    const db = this.client.db(dbName);

    if (!this.initialized) {
      await this.ensureSchema(db);
      this.initialized = true;
    }

    return db;
  }

  private async ensureSchema(db: Awaited<ReturnType<MongoStore['getDb']>>) {
    const projects = db.collection<MongoProjectDocument>('projects');
    const projectFiles =
      db.collection<MongoProjectFileDocument>('projectFiles');

    await projects.createIndex(
      { ownerEmail: 1 },
      { name: 'idx_projects_owner_email' },
    );
    await projects.createIndex(
      { 'collaborators.email': 1, 'collaborators.status': 1 },
      { name: 'idx_projects_collaborators_access' },
    );
    await projectFiles.createIndex(
      { projectId: 1, fileId: 1 },
      { unique: true, name: 'uniq_project_file' },
    );
    await projectFiles.createIndex(
      { projectId: 1 },
      { name: 'idx_project_files_project_id' },
    );
  }

  private async projectsCollection() {
    return (await this.getDb()).collection<MongoProjectDocument>('projects');
  }

  private async projectFilesCollection() {
    return (await this.getDb()).collection<MongoProjectFileDocument>(
      'projectFiles',
    );
  }

  async ensureReady(): Promise<void> {
    await this.getDb();
  }

  async hasAnyProjects(): Promise<boolean> {
    return (
      (await (
        await this.projectsCollection()
      ).countDocuments({}, { limit: 1 })) > 0
    );
  }

  async listProjects(
    requesterEmail: string,
    ownerEmail?: string,
  ): Promise<MongoProjectRecord[]> {
    const filter: Filter<MongoProjectDocument> = ownerEmail
      ? {
          ownerEmail,
          $or: [
            { ownerEmail: requesterEmail },
            {
              collaborators: {
                $elemMatch: { email: requesterEmail, status: 'approved' },
              },
            },
          ],
        }
      : {
          $or: [
            { ownerEmail: requesterEmail },
            {
              collaborators: {
                $elemMatch: { email: requesterEmail, status: 'approved' },
              },
            },
          ],
        };

    const docs = await (await this.projectsCollection()).find(filter).toArray();
    return sortProjectsByRecency(docs.map(toProjectRecord));
  }

  async findProjectById(projectId: string): Promise<MongoProjectRecord | null> {
    const doc = await (
      await this.projectsCollection()
    ).findOne({ _id: projectId });
    return doc ? toProjectRecord(doc) : null;
  }

  async findProjectByOwnerAndId(
    ownerEmail: string,
    projectId: string,
  ): Promise<MongoProjectRecord | null> {
    const doc = await (
      await this.projectsCollection()
    ).findOne({
      _id: projectId,
      ownerEmail,
    });
    return doc ? toProjectRecord(doc) : null;
  }

  async insertProject(input: {
    id: string;
    name: string;
    ownerId: string;
    ownerEmail: string;
    createdAt: string;
    updatedAt?: string;
    lastOpenedAt?: string;
    description?: string;
    imported?: boolean;
    hasTexFile?: boolean;
    collaborators: ProjectCollaborator[];
    files: ProjectFile[];
  }): Promise<StoredFileIndexNode[]> {
    const filesIndex = buildFilesPayload(input.files);
    const docs = this.flattenFiles(input.id, input.files);
    const projectFiles = await this.projectFilesCollection();

    if (docs.length > 0) {
      await projectFiles.bulkWrite(
        docs.map((doc) => ({
          replaceOne: {
            filter: { _id: doc._id },
            replacement: doc,
            upsert: true,
          },
        })),
      );
    }

    await (
      await this.projectsCollection()
    ).insertOne({
      _id: input.id,
      ownerId: input.ownerId,
      ownerEmail: input.ownerEmail,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      lastOpenedAt: input.lastOpenedAt,
      imported: Boolean(input.imported),
      hasTexFile: input.hasTexFile !== false,
      nameEncrypted: encryptString(input.name, 'project', input.id, 'name'),
      descriptionEncrypted: input.description
        ? encryptString(input.description, 'project', input.id, 'description')
        : null,
      filesIndex,
      collaborators: input.collaborators,
    });

    return filesIndex;
  }

  async updateProject(
    projectId: string,
    patch: Partial<{
      name: string;
      updatedAt: string;
      lastOpenedAt: string;
      description: string | null;
      imported: boolean;
      hasTexFile: boolean;
      collaborators: ProjectCollaborator[];
      filesIndex: StoredFileIndexNode[];
    }>,
  ): Promise<void> {
    const setPatch: Partial<MongoProjectDocument> = {};

    if (patch.name !== undefined) {
      setPatch.nameEncrypted = encryptString(
        patch.name,
        'project',
        projectId,
        'name',
      );
    }

    if (patch.updatedAt !== undefined) {
      setPatch.updatedAt = patch.updatedAt;
    }

    if (patch.lastOpenedAt !== undefined) {
      setPatch.lastOpenedAt = patch.lastOpenedAt;
    }

    if (patch.description !== undefined) {
      setPatch.descriptionEncrypted =
        patch.description === null
          ? null
          : encryptString(
              patch.description,
              'project',
              projectId,
              'description',
            );
    }

    if (patch.imported !== undefined) {
      setPatch.imported = patch.imported;
    }

    if (patch.hasTexFile !== undefined) {
      setPatch.hasTexFile = patch.hasTexFile;
    }

    if (patch.collaborators !== undefined) {
      setPatch.collaborators = patch.collaborators;
    }

    if (patch.filesIndex !== undefined) {
      setPatch.filesIndex = patch.filesIndex;
    }

    if (Object.keys(setPatch).length === 0) {
      return;
    }

    await (
      await this.projectsCollection()
    ).updateOne({ _id: projectId }, { $set: setPatch });
  }

  async approveProjectCollaborator(
    projectId: string,
    collaboratorId: string,
  ): Promise<boolean> {
    const result = await (
      await this.projectsCollection()
    ).updateOne(
      { _id: projectId, 'collaborators.id': collaboratorId },
      { $set: { 'collaborators.$.status': 'approved' } },
    );
    return result.modifiedCount > 0;
  }

  async deleteProjectCollaborator(
    projectId: string,
    collaboratorId: string,
  ): Promise<boolean> {
    const collection = await this.projectsCollection();
    const project = await collection.findOne({ _id: projectId });

    if (!project) {
      return false;
    }

    const nextCollaborators = (project.collaborators ?? []).filter(
      (collaborator) => collaborator.id !== collaboratorId,
    );

    if (nextCollaborators.length === (project.collaborators ?? []).length) {
      return false;
    }

    const result = await collection.updateOne(
      { _id: projectId },
      { $set: { collaborators: nextCollaborators } },
    );
    return result.modifiedCount > 0;
  }

  async deleteProject(projectId: string): Promise<void> {
    await (await this.projectsCollection()).deleteOne({ _id: projectId });
    await this.deleteProjectFiles(projectId);
  }

  private flattenFiles(
    projectId: string,
    files: ProjectFile[],
  ): MongoProjectFileDocument[] {
    const docs: MongoProjectFileDocument[] = [];

    const visit = (nodes: ProjectFile[]) => {
      for (const node of nodes) {
        if (node.type === 'folder') {
          visit(node.children ?? []);
          continue;
        }

        docs.push({
          _id: toProjectFileDocumentId(projectId, node.id),
          projectId,
          fileId: node.id,
          type: node.type,
          createdAt: node.createdAt,
          contentEncrypted: encryptString(
            node.content ?? '',
            'project-file',
            projectId,
            node.id,
          ),
        });
      }
    };

    visit(files);
    return docs;
  }

  async replaceProjectFiles(
    projectId: string,
    files: ProjectFile[],
  ): Promise<StoredFileIndexNode[]> {
    const filesIndex = buildFilesPayload(files);
    const docs = this.flattenFiles(projectId, files);
    const fileIds = docs.map((doc) => doc.fileId);
    const collection = await this.projectFilesCollection();

    await collection.deleteMany(
      fileIds.length > 0
        ? { projectId, fileId: { $nin: fileIds } }
        : { projectId },
    );

    if (docs.length > 0) {
      await collection.bulkWrite(
        docs.map((doc) => ({
          replaceOne: {
            filter: { _id: doc._id },
            replacement: doc,
            upsert: true,
          },
        })),
      );
    }

    return filesIndex;
  }

  async readProjectFiles(
    projectId: string,
    nodes: StoredFileIndexNode[],
  ): Promise<ProjectFile[]> {
    const docs = await (await this.projectFilesCollection())
      .find({ projectId })
      .toArray();

    const contentById = new Map(
      docs.map((doc) => [
        doc.fileId,
        decryptString(
          doc.contentEncrypted,
          'project-file',
          projectId,
          doc.fileId,
        ),
      ]),
    );

    const hydrate = async (
      entries: StoredFileIndexNode[],
    ): Promise<ProjectFile[]> =>
      Promise.all(
        entries.map(async (entry) => {
          if (entry.type === 'folder') {
            return {
              id: entry.id,
              name: entry.name,
              type: 'folder',
              createdAt: entry.createdAt,
              children: await hydrate(entry.children ?? []),
            };
          }

          return {
            id: entry.id,
            name: entry.name,
            type: entry.type,
            createdAt: entry.createdAt,
            content: contentById.get(entry.id) ?? '',
          };
        }),
      );

    return hydrate(nodes);
  }

  async updateProjectFileContent(
    projectId: string,
    file: Pick<ProjectFile, 'id' | 'type' | 'createdAt'>,
    content: string,
  ): Promise<void> {
    await (
      await this.projectFilesCollection()
    ).updateOne(
      { _id: toProjectFileDocumentId(projectId, file.id) },
      {
        $set: {
          projectId,
          fileId: file.id,
          type: file.type,
          createdAt: file.createdAt,
          contentEncrypted: encryptString(
            content,
            'project-file',
            projectId,
            file.id,
          ),
        },
      },
      { upsert: true },
    );
  }

  async deleteProjectFiles(projectId: string): Promise<void> {
    await (await this.projectFilesCollection()).deleteMany({ projectId });
  }
}

export const mongoStore = new MongoStore();
