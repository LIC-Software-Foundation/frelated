import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import type { ProjectCollaborator } from '../domain/models';
import type { StoredFileIndexNode } from '../services/fileStore';

export interface PrismaUserRecord {
  id: string;
  name: string;
  email: string;
  joinedAt: string;
  passwordHash: string;
  passwordSalt: string;
  organization?: string;
}

export interface PrismaProjectRecord {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail: string;
  createdAt: string;
  updatedAt?: string;
  lastOpenedAt?: string;
  description?: string;
  rootPath: string;
  imported: boolean;
  hasTexFile: boolean;
  filesIndex: StoredFileIndexNode[];
  collaborators: ProjectCollaborator[];
}

interface PrismaUserRow {
  id: string;
  name: string;
  email: string;
  joined_at: Date | string;
  password_hash: string;
  password_salt: string;
  organization: string | null;
}

interface PrismaProjectRow {
  id: string;
  name: string;
  owner_id: string;
  owner_email: string;
  created_at: Date | string;
  updated_at: Date | string | null;
  last_opened_at: Date | string | null;
  description: string | null;
  root_path: string;
  imported: number | boolean;
  has_tex_file: number | boolean;
  files_index_json: string | StoredFileIndexNode[];
}

interface PrismaCollaboratorRow {
  id: string;
  project_id: string;
  user_id: string | null;
  name: string;
  email: string;
  role: 'VIEWER' | 'EDITOR' | 'OWNER';
  status: 'PENDING' | 'APPROVED';
  is_online: number | boolean;
}

const toIsoString = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : undefined;

// MySQL DATETIME columns expect 'YYYY-MM-DD HH:MM:SS', not ISO 8601 with 'T' and 'Z'.
const toMysqlDatetime = (
  value: string | Date | null | undefined,
): string | null => {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
};

const toDatabaseRole = (role: ProjectCollaborator['role']) => {
  switch (role) {
    case 'viewer':
      return 'VIEWER';
    case 'owner':
      return 'OWNER';
    default:
      return 'EDITOR';
  }
};

const fromDatabaseRole = (
  role: PrismaCollaboratorRow['role'],
): ProjectCollaborator['role'] => {
  switch (role) {
    case 'VIEWER':
      return 'viewer';
    case 'OWNER':
      return 'owner';
    default:
      return 'editor';
  }
};

const toDatabaseStatus = (
  status: ProjectCollaborator['status'],
): 'PENDING' | 'APPROVED' => (status === 'pending' ? 'PENDING' : 'APPROVED');

const fromDatabaseStatus = (
  status: 'PENDING' | 'APPROVED',
): ProjectCollaborator['status'] =>
  status === 'PENDING' ? 'pending' : 'approved';

const parseFilesIndex = (
  value: PrismaProjectRow['files_index_json'],
): StoredFileIndexNode[] => {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value) {
    return [];
  }

  try {
    return JSON.parse(value) as StoredFileIndexNode[];
  } catch {
    return [];
  }
};

const sortProjectsByRecency = (projects: PrismaProjectRecord[]) =>
  [...projects].sort((first, second) => {
    const firstDate =
      first.lastOpenedAt || first.updatedAt || first.createdAt || '';
    const secondDate =
      second.lastOpenedAt || second.updatedAt || second.createdAt || '';
    return secondDate.localeCompare(firstDate);
  });

class PrismaStore {
  private client: PrismaClient | null = null;
  private usersInitialized = false;
  private projectsInitialized = false;

  isEnabled(): boolean {
    return Boolean(env.databaseUrl);
  }

  private getClient(): PrismaClient {
    if (!this.client) {
      this.client = new PrismaClient();
    }

    return this.client;
  }

  private async ensureUserSchema(): Promise<void> {
    if (this.usersInitialized) {
      return;
    }

    const client = this.getClient();

    await client.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        joined_at DATETIME NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        password_salt VARCHAR(255) NOT NULL,
        organization VARCHAR(255) NULL
      )
    `);

    this.usersInitialized = true;
  }

  private async ensureProjectSchema(): Promise<void> {
    if (this.projectsInitialized) {
      return;
    }

    await this.ensureUserSchema();

    const client = this.getClient();

    await client.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS projects (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        owner_id VARCHAR(64) NOT NULL,
        owner_email VARCHAR(255) NOT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NULL,
        last_opened_at DATETIME NULL,
        description TEXT NULL,
        root_path VARCHAR(1024) NOT NULL,
        imported TINYINT(1) NOT NULL DEFAULT 0,
        has_tex_file TINYINT(1) NOT NULL DEFAULT 1,
        files_index_json JSON NOT NULL,
        INDEX idx_projects_owner_email (owner_email),
        CONSTRAINT fk_projects_owner
          FOREIGN KEY (owner_id) REFERENCES users(id)
          ON DELETE CASCADE
      )
    `);

    await client.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS project_collaborators (
        id VARCHAR(64) PRIMARY KEY,
        project_id VARCHAR(64) NOT NULL,
        user_id VARCHAR(64) NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        role ENUM('VIEWER', 'EDITOR', 'OWNER') NOT NULL,
        status ENUM('PENDING', 'APPROVED') NOT NULL DEFAULT 'APPROVED',
        is_online TINYINT(1) NOT NULL DEFAULT 0,
        can_read TINYINT(1) NOT NULL DEFAULT 1,
        can_write TINYINT(1) NOT NULL DEFAULT 1,
        UNIQUE KEY uniq_project_collaborator_email (project_id, email),
        KEY idx_project_collaborators_user_id (user_id),
        CONSTRAINT fk_project_collaborators_project
          FOREIGN KEY (project_id) REFERENCES projects(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_project_collaborators_user
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE SET NULL
      )
    `);

    // Add status column if it doesn't exist yet (migration for existing tables)
    await client
      .$executeRawUnsafe(
        `
      ALTER TABLE project_collaborators
      ADD COLUMN IF NOT EXISTS status ENUM('PENDING', 'APPROVED') NOT NULL DEFAULT 'APPROVED'
    `,
      )
      .catch(() => undefined);

    this.projectsInitialized = true;
  }

  private async resolveUserIdsByEmail(emails: string[]) {
    await this.ensureUserSchema();

    const client = this.getClient();
    const uniqueEmails = [...new Set(emails)].filter(Boolean);

    if (uniqueEmails.length === 0) {
      return new Map<string, string>();
    }

    const placeholders = uniqueEmails.map(() => '?').join(', ');
    const rows = (await client.$queryRawUnsafe(
      `SELECT id, email FROM users WHERE email IN (${placeholders})`,
      ...uniqueEmails,
    )) as Array<{ id: string; email: string }>;

    return new Map(rows.map((user) => [user.email, user.id]));
  }

  private async readCollaborators(projectIds: string[]) {
    await this.ensureProjectSchema();

    const client = this.getClient();
    const uniqueProjectIds = [...new Set(projectIds)];

    if (uniqueProjectIds.length === 0) {
      return new Map<string, ProjectCollaborator[]>();
    }

    const placeholders = uniqueProjectIds.map(() => '?').join(', ');
    const rows = (await client.$queryRawUnsafe(
      `SELECT id, project_id, user_id, name, email, role, status, is_online
       FROM project_collaborators
       WHERE project_id IN (${placeholders})`,
      ...uniqueProjectIds,
    )) as PrismaCollaboratorRow[];

    const grouped = new Map<string, ProjectCollaborator[]>();

    for (const row of rows) {
      const collaborators = grouped.get(row.project_id) || [];
      collaborators.push({
        id: row.id,
        name: row.name,
        email: row.email,
        role: fromDatabaseRole(row.role),
        status: fromDatabaseStatus(row.status ?? 'APPROVED'),
        isOnline: Boolean(row.is_online),
      });
      grouped.set(row.project_id, collaborators);
    }

    return grouped;
  }

  private async mapProjects(rows: PrismaProjectRow[]) {
    const collaboratorsByProject = await this.readCollaborators(
      rows.map((row) => row.id),
    );

    return sortProjectsByRecency(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        ownerId: row.owner_id,
        ownerEmail: row.owner_email,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: toIsoString(row.updated_at),
        lastOpenedAt: toIsoString(row.last_opened_at),
        description: row.description || undefined,
        rootPath: row.root_path,
        imported: Boolean(row.imported),
        hasTexFile: Boolean(row.has_tex_file),
        filesIndex: parseFilesIndex(row.files_index_json),
        collaborators: collaboratorsByProject.get(row.id) || [],
      })),
    );
  }

  async findUserByEmail(email: string): Promise<PrismaUserRecord | null> {
    await this.ensureUserSchema();

    const client = this.getClient();
    const rows = (await client.$queryRawUnsafe(
      'SELECT * FROM users WHERE email = ? LIMIT 1',
      email,
    )) as PrismaUserRow[];

    const user = rows[0];
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      joinedAt: new Date(user.joined_at).toISOString(),
      passwordHash: user.password_hash,
      passwordSalt: user.password_salt,
      organization: user.organization || undefined,
    };
  }

  async createUser(input: PrismaUserRecord): Promise<void> {
    await this.ensureUserSchema();

    const client = this.getClient();
    await client.$executeRawUnsafe(
      `INSERT INTO users
        (id, name, email, joined_at, password_hash, password_salt, organization)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      input.name,
      input.email,
      toMysqlDatetime(input.joinedAt),
      input.passwordHash,
      input.passwordSalt,
      input.organization || null,
    );
  }

  async seedUserIfMissing(input: PrismaUserRecord): Promise<void> {
    const existing = await this.findUserByEmail(input.email);
    if (existing) {
      return;
    }

    await this.createUser(input);
  }

  /**
   * Returns true if any projects exist in the database (used for seeding).
   * Does not enforce access control — internal use only.
   */
  async hasAnyProjects(): Promise<boolean> {
    await this.ensureProjectSchema();
    const client = this.getClient();
    const rows = (await client.$queryRawUnsafe(
      'SELECT 1 FROM projects LIMIT 1',
    )) as unknown[];
    return rows.length > 0;
  }

  /**
   * Lists projects accessible to `requesterEmail` (owned or approved collaborator).
   * Optionally filtered to a specific `ownerEmail`.
   * Access control is enforced at the SQL level.
   */
  async listProjects(
    requesterEmail: string,
    ownerEmail?: string,
  ): Promise<PrismaProjectRecord[]> {
    await this.ensureProjectSchema();

    const client = this.getClient();
    let rows: PrismaProjectRow[];

    if (ownerEmail) {
      rows = (await client.$queryRawUnsafe(
        `SELECT DISTINCT p.* FROM projects p
         LEFT JOIN project_collaborators pc ON pc.project_id = p.id
         WHERE p.owner_email = ?
           AND (p.owner_email = ? OR (pc.email = ? AND pc.status = 'APPROVED'))`,
        ownerEmail,
        requesterEmail,
        requesterEmail,
      )) as PrismaProjectRow[];
    } else {
      rows = (await client.$queryRawUnsafe(
        `SELECT DISTINCT p.* FROM projects p
         LEFT JOIN project_collaborators pc ON pc.project_id = p.id
         WHERE p.owner_email = ? OR (pc.email = ? AND pc.status = 'APPROVED')`,
        requesterEmail,
        requesterEmail,
      )) as PrismaProjectRow[];
    }

    return this.mapProjects(rows);
  }

  /**
   * Approve a specific collaborator row by its ID (targeted UPDATE — avoids PK conflicts).
   * Returns true if a row was actually updated.
   */
  async approveProjectCollaborator(
    projectId: string,
    collaboratorId: string,
  ): Promise<boolean> {
    await this.ensureProjectSchema();
    const client = this.getClient();
    const count = await client.$executeRawUnsafe(
      `UPDATE project_collaborators SET status = 'APPROVED'
       WHERE id = ? AND project_id = ?`,
      collaboratorId,
      projectId,
    );
    return count > 0;
  }

  /**
   * Delete a specific collaborator row by its ID (targeted DELETE — avoids PK conflicts).
   * Returns true if a row was actually deleted.
   */
  async deleteProjectCollaborator(
    projectId: string,
    collaboratorId: string,
  ): Promise<boolean> {
    await this.ensureProjectSchema();
    const client = this.getClient();
    const count = await client.$executeRawUnsafe(
      `DELETE FROM project_collaborators WHERE id = ? AND project_id = ?`,
      collaboratorId,
      projectId,
    );
    return count > 0;
  }

  async findProjectById(
    projectId: string,
  ): Promise<PrismaProjectRecord | null> {
    await this.ensureProjectSchema();

    const client = this.getClient();
    const rows = (await client.$queryRawUnsafe(
      'SELECT * FROM projects WHERE id = ? LIMIT 1',
      projectId,
    )) as PrismaProjectRow[];

    const projects = await this.mapProjects(rows);
    return projects[0] || null;
  }

  async findProjectByOwnerAndId(
    ownerEmail: string,
    projectId: string,
  ): Promise<PrismaProjectRecord | null> {
    await this.ensureProjectSchema();

    const client = this.getClient();
    const rows = (await client.$queryRawUnsafe(
      'SELECT * FROM projects WHERE owner_email = ? AND id = ? LIMIT 1',
      ownerEmail,
      projectId,
    )) as PrismaProjectRow[];

    const projects = await this.mapProjects(rows);
    return projects[0] || null;
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
    rootPath: string;
    imported?: boolean;
    hasTexFile?: boolean;
    collaborators: ProjectCollaborator[];
    filesIndex: StoredFileIndexNode[];
  }): Promise<void> {
    await this.ensureProjectSchema();

    const client = this.getClient();
    await client.$executeRawUnsafe(
      `INSERT INTO projects
        (id, name, owner_id, owner_email, created_at, updated_at, last_opened_at, description, root_path, imported, has_tex_file, files_index_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      input.name,
      input.ownerId,
      input.ownerEmail,
      toMysqlDatetime(input.createdAt),
      toMysqlDatetime(input.updatedAt),
      toMysqlDatetime(input.lastOpenedAt),
      input.description || null,
      input.rootPath,
      input.imported ? 1 : 0,
      input.hasTexFile === false ? 0 : 1,
      JSON.stringify(input.filesIndex),
    );

    const usersByEmail = await this.resolveUserIdsByEmail(
      input.collaborators.map((collaborator) => collaborator.email),
    );

    for (const collaborator of input.collaborators) {
      await client.$executeRawUnsafe(
        `INSERT INTO project_collaborators
          (id, project_id, user_id, name, email, role, status, is_online, can_read, can_write)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        collaborator.id,
        input.id,
        usersByEmail.get(collaborator.email) || null,
        collaborator.name,
        collaborator.email,
        toDatabaseRole(collaborator.role),
        toDatabaseStatus(collaborator.status),
        collaborator.isOnline ? 1 : 0,
        1,
        collaborator.role === 'viewer' ? 0 : 1,
      );
    }
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
    await this.ensureProjectSchema();

    const client = this.getClient();
    const entries: Array<[string, string | number | null]> = [];

    if (patch.name !== undefined) {
      entries.push(['name', patch.name]);
    }

    if (patch.updatedAt !== undefined) {
      entries.push(['updated_at', toMysqlDatetime(patch.updatedAt)]);
    }

    if (patch.lastOpenedAt !== undefined) {
      entries.push(['last_opened_at', toMysqlDatetime(patch.lastOpenedAt)]);
    }

    if (patch.description !== undefined) {
      entries.push(['description', patch.description]);
    }

    if (patch.imported !== undefined) {
      entries.push(['imported', patch.imported ? 1 : 0]);
    }

    if (patch.hasTexFile !== undefined) {
      entries.push(['has_tex_file', patch.hasTexFile ? 1 : 0]);
    }

    if (patch.filesIndex !== undefined) {
      entries.push(['files_index_json', JSON.stringify(patch.filesIndex)]);
    }

    if (entries.length > 0) {
      const sql = entries.map(([field]) => `${field} = ?`).join(', ');
      const values = entries.map(([, value]) => value);

      await client.$executeRawUnsafe(
        `UPDATE projects SET ${sql} WHERE id = ?`,
        ...values,
        projectId,
      );
    }

    if (patch.collaborators) {
      // Upsert approach: UPDATE existing rows, INSERT new ones with fresh UUIDs.
      // This avoids PRIMARY KEY conflicts that occur when a collaborator's UUID
      // was previously shared with their user row in another project.

      // Fetch current collaborator rows for this project (by email → id mapping)
      const existingRows = (await client.$queryRawUnsafe(
        'SELECT id, email FROM project_collaborators WHERE project_id = ?',
        projectId,
      )) as Array<{ id: string; email: string }>;

      const existingByEmail = new Map(
        existingRows.map((r) => [r.email.toLowerCase(), r.id]),
      );
      const newEmails = new Set(
        patch.collaborators.map((c) => c.email.toLowerCase()),
      );

      // Delete collaborators that were removed from the list
      for (const [email, id] of existingByEmail) {
        if (!newEmails.has(email)) {
          await client.$executeRawUnsafe(
            'DELETE FROM project_collaborators WHERE project_id = ? AND id = ?',
            projectId,
            id,
          );
        }
      }

      const usersByEmail = await this.resolveUserIdsByEmail(
        patch.collaborators.map((c) => c.email),
      );

      // Update existing or insert new collaborator rows
      for (const collaborator of patch.collaborators) {
        const email = collaborator.email.toLowerCase();
        const existingId = existingByEmail.get(email);

        if (existingId) {
          // Update existing row using its current ID — safe from PK conflicts
          await client.$executeRawUnsafe(
            `UPDATE project_collaborators
             SET name = ?, role = ?, status = ?, is_online = ?, can_write = ?
             WHERE id = ? AND project_id = ?`,
            collaborator.name,
            toDatabaseRole(collaborator.role),
            toDatabaseStatus(collaborator.status),
            collaborator.isOnline ? 1 : 0,
            collaborator.role === 'viewer' ? 0 : 1,
            existingId,
            projectId,
          );
        } else {
          // Preserve the caller-assigned id so the id stored in notifications
          // matches the row id used later for approve/reject.
          const newId = collaborator.id || randomUUID();
          await client.$executeRawUnsafe(
            `INSERT INTO project_collaborators
              (id, project_id, user_id, name, email, role, status, is_online, can_read, can_write)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            newId,
            projectId,
            usersByEmail.get(collaborator.email) || null,
            collaborator.name,
            email,
            toDatabaseRole(collaborator.role),
            toDatabaseStatus(collaborator.status),
            collaborator.isOnline ? 1 : 0,
            1,
            collaborator.role === 'viewer' ? 0 : 1,
          );
        }
      }
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.ensureProjectSchema();

    const client = this.getClient();
    await client.$executeRawUnsafe(
      'DELETE FROM projects WHERE id = ?',
      projectId,
    );
  }
}

export const prismaStore = new PrismaStore();
