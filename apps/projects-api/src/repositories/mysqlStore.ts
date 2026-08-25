import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import { env } from '../config/env';

export type ProjectRow = RowDataPacket & {
  id: string;
  name: string;
  owner_email: string;
  created_at: string;
  updated_at: string | null;
  last_opened_at: string | null;
  description: string | null;
  root_path: string;
  imported: number;
  has_tex_file: number;
  collaborators_json: string;
  files_index_json: string;
};

export type UserRow = RowDataPacket & {
  id: string;
  name: string;
  email: string;
  joined_at: string;
  password_hash: string;
  password_salt: string;
  organization: string | null;
};

class MysqlStore {
  private pool: Pool | null = null;
  private initialized = false;

  isEnabled(): boolean {
    return env.persistenceDriver === 'mysql' && Boolean(env.databaseUrl);
  }

  private async getPool(): Promise<Pool> {
    if (!this.pool) {
      this.pool = createPool(env.databaseUrl);
    }

    if (!this.initialized) {
      await this.ensureSchema();
      this.initialized = true;
    }

    return this.pool;
  }

  private async ensureSchema(): Promise<void> {
    const pool = this.pool;
    if (!pool) return;

    await pool.query(`
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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        owner_email VARCHAR(255) NOT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NULL,
        last_opened_at DATETIME NULL,
        description TEXT NULL,
        root_path VARCHAR(1024) NOT NULL,
        imported TINYINT(1) NOT NULL DEFAULT 0,
        has_tex_file TINYINT(1) NOT NULL DEFAULT 1,
        collaborators_json JSON NOT NULL,
        files_index_json JSON NOT NULL,
        INDEX idx_projects_owner_email (owner_email)
      )
    `);
  }

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const pool = await this.getPool();
    const [rows] = await pool.query<UserRow[]>(
      'SELECT * FROM users WHERE email = ? LIMIT 1',
      [email],
    );
    return rows[0] || null;
  }

  async createUser(input: {
    id: string;
    name: string;
    email: string;
    joinedAt: string;
    passwordHash: string;
    passwordSalt: string;
    organization?: string;
  }): Promise<void> {
    const pool = await this.getPool();
    await pool.query(
      `INSERT INTO users
        (id, name, email, joined_at, password_hash, password_salt, organization)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.name,
        input.email,
        input.joinedAt,
        input.passwordHash,
        input.passwordSalt,
        input.organization || null,
      ],
    );
  }

  async seedUserIfMissing(input: {
    id: string;
    name: string;
    email: string;
    joinedAt: string;
    passwordHash: string;
    passwordSalt: string;
    organization?: string;
  }): Promise<void> {
    const existing = await this.findUserByEmail(input.email);
    if (existing) return;
    await this.createUser(input);
  }

  async listProjects(ownerEmail?: string): Promise<ProjectRow[]> {
    const pool = await this.getPool();
    const [rows] = ownerEmail
      ? await pool.query<ProjectRow[]>(
          'SELECT * FROM projects WHERE owner_email = ? ORDER BY COALESCE(last_opened_at, updated_at, created_at) DESC',
          [ownerEmail],
        )
      : await pool.query<ProjectRow[]>(
          'SELECT * FROM projects ORDER BY COALESCE(last_opened_at, updated_at, created_at) DESC',
        );
    return rows;
  }

  async findProjectById(projectId: string): Promise<ProjectRow | null> {
    const pool = await this.getPool();
    const [rows] = await pool.query<ProjectRow[]>(
      'SELECT * FROM projects WHERE id = ? LIMIT 1',
      [projectId],
    );
    return rows[0] || null;
  }

  async findProjectByOwnerAndId(
    ownerEmail: string,
    projectId: string,
  ): Promise<ProjectRow | null> {
    const pool = await this.getPool();
    const [rows] = await pool.query<ProjectRow[]>(
      'SELECT * FROM projects WHERE owner_email = ? AND id = ? LIMIT 1',
      [ownerEmail, projectId],
    );
    return rows[0] || null;
  }

  async insertProject(input: {
    id: string;
    name: string;
    ownerEmail: string;
    createdAt: string;
    updatedAt?: string;
    lastOpenedAt?: string;
    description?: string;
    rootPath: string;
    imported?: boolean;
    hasTexFile?: boolean;
    collaboratorsJson: string;
    filesIndexJson: string;
  }): Promise<void> {
    const pool = await this.getPool();
    await pool.query(
      `INSERT INTO projects
      (id, name, owner_email, created_at, updated_at, last_opened_at, description, root_path, imported, has_tex_file, collaborators_json, files_index_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.name,
        input.ownerEmail,
        input.createdAt,
        input.updatedAt || null,
        input.lastOpenedAt || null,
        input.description || null,
        input.rootPath,
        input.imported ? 1 : 0,
        input.hasTexFile === false ? 0 : 1,
        input.collaboratorsJson,
        input.filesIndexJson,
      ],
    );
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
      collaboratorsJson: string;
      filesIndexJson: string;
    }>,
  ): Promise<void> {
    const pool = await this.getPool();
    const entries = Object.entries(patch).filter(
      ([, value]) => value !== undefined,
    );
    if (entries.length === 0) return;

    const fieldMap: Record<string, string> = {
      name: 'name',
      updatedAt: 'updated_at',
      lastOpenedAt: 'last_opened_at',
      description: 'description',
      imported: 'imported',
      hasTexFile: 'has_tex_file',
      collaboratorsJson: 'collaborators_json',
      filesIndexJson: 'files_index_json',
    };

    const sql = entries.map(([key]) => `${fieldMap[key]} = ?`).join(', ');
    const values = entries.map(([, value]) =>
      typeof value === 'boolean' ? (value ? 1 : 0) : value,
    );

    await pool.query(`UPDATE projects SET ${sql} WHERE id = ?`, [
      ...values,
      projectId,
    ]);
  }

  async deleteProject(projectId: string): Promise<void> {
    const pool = await this.getPool();
    await pool.query('DELETE FROM projects WHERE id = ?', [projectId]);
  }
}

export const mysqlStore = new MysqlStore();
