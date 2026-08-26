import { v4 as uuidv4 } from 'uuid';
import type { Collaborator, User } from '@frelated/types';
import { readApiSession } from './api/sessionStorage';
import { addLocalNotification } from './notificationService';
import {
  DEFAULT_FIGURES_FOLDER,
  MINIMAL_LATEX_TEMPLATE,
  PROJECTS_STORAGE_KEY,
  SUPPORTED_IMAGE_EXTENSIONS,
} from '../data/projects';
import { ProjectFile, ProjectWithFiles } from '../types';
import type { ProjectImportResult } from './project.types';

const delay = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

export type { ProjectImportResult } from './project.types';

interface ZipEntry {
  name: string;
  data: Uint8Array;
  isDirectory: boolean;
}

const parseStoredProjects = (): ProjectWithFiles[] => {
  const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
  if (!raw) return [];

  try {
    return JSON.parse(raw) as ProjectWithFiles[];
  } catch (error) {
    console.warn('Impossible de lire les projets mockés', error);
    return [];
  }
};

const persistProjects = (projects: ProjectWithFiles[]) => {
  localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
};

export const sortProjectsByActivity = (
  projects: ProjectWithFiles[],
): ProjectWithFiles[] =>
  [...projects].sort((a, b) => {
    const first = new Date(
      a.lastOpenedAt ?? a.updatedAt ?? a.createdAt,
    ).getTime();
    const second = new Date(
      b.lastOpenedAt ?? b.updatedAt ?? b.createdAt,
    ).getTime();
    return second - first;
  });

export const createDefaultFiles = (projectName: string): ProjectFile[] => [
  {
    id: uuidv4(),
    name: 'main.tex',
    type: 'tex',
    content: MINIMAL_LATEX_TEMPLATE.replace('__PROJECT_NAME__', projectName),
    createdAt: new Date().toISOString(),
  },
  {
    id: uuidv4(),
    name: 'references.bib',
    type: 'bib',
    content: '',
    createdAt: new Date().toISOString(),
  },
  {
    id: uuidv4(),
    name: DEFAULT_FIGURES_FOLDER,
    type: 'folder',
    children: [],
    createdAt: new Date().toISOString(),
  },
];

const readProjectsByOwner = (ownerEmail: string): ProjectWithFiles[] =>
  sortProjectsByActivity(
    parseStoredProjects().filter((project) => project.owner === ownerEmail),
  );

const writeProjectsByOwner = (
  ownerEmail: string,
  nextProjects: ProjectWithFiles[],
): void => {
  const allProjects = parseStoredProjects();
  const otherProjects = allProjects.filter(
    (project) => project.owner !== ownerEmail,
  );
  persistProjects([...otherProjects, ...nextProjects]);
};

const updateProjectInStorage = async (
  ownerEmail: string,
  projectId: string,
  recipe: (project: ProjectWithFiles) => ProjectWithFiles,
): Promise<ProjectWithFiles | undefined> => {
  await delay(120);

  let updatedProject: ProjectWithFiles | undefined;
  const nextProjects = readProjectsByOwner(ownerEmail).map((project) => {
    if (project.id !== projectId) return project;
    updatedProject = recipe(project);
    return updatedProject;
  });

  writeProjectsByOwner(ownerEmail, sortProjectsByActivity(nextProjects));
  return updatedProject;
};

export async function listProjects(
  ownerEmail: string,
): Promise<ProjectWithFiles[]> {
  await delay(120);

  if (ownerEmail) {
    return readProjectsByOwner(ownerEmail);
  }

  // No filter: return all projects accessible to the current session user
  // (owned projects + projects where user is an approved collaborator)
  const currentEmail = readApiSession()?.user?.email;
  if (!currentEmail) return [];

  return sortProjectsByActivity(
    parseStoredProjects().filter((project) => {
      if (project.owner === currentEmail) return true;
      return project.collaborators.some(
        (c) =>
          c.email === currentEmail &&
          (!(c as { status?: string }).status ||
            (c as { status?: string }).status === 'approved'),
      );
    }),
  );
}

export async function getSharedProject(
  ownerEmail: string,
  projectId: string,
): Promise<ProjectWithFiles> {
  await delay(120);

  const projects = parseStoredProjects();
  const project = projects.find(
    (entry) => entry.id === projectId && entry.owner === ownerEmail,
  );

  if (!project) {
    throw new Error('Projet partage introuvable.');
  }

  const currentEmail = readApiSession()?.user?.email;

  // Owner always has access
  if (!currentEmail || currentEmail === project.owner) {
    return project;
  }

  const existing = project.collaborators.find((c) => c.email === currentEmail);

  if (existing) {
    if ((existing as { status?: string }).status === 'pending') {
      throw new Error('PENDING_APPROVAL');
    }
    return project;
  }

  // New visitor: add as pending and push a local notification to the owner
  const session = readApiSession();
  const requester = session?.user;
  if (!requester) throw new Error('PENDING_APPROVAL');

  // Fresh UUID for the collaborator row (not the user UUID) — mirrors the API behaviour
  const pendingCollaboratorId = uuidv4();

  project.collaborators.push({
    id: pendingCollaboratorId,
    name: requester.name,
    email: requester.email,
    role: 'editor',
    isOnline: false,
    status: 'pending',
  } as Collaborator & { status: string });

  project.updatedAt = new Date().toISOString();
  persistProjects(projects);

  // Notify the owner via the local notification store (mock mode)
  addLocalNotification({
    id: uuidv4(),
    type: 'collaboration_request',
    read: false,
    createdAt: new Date().toISOString(),
    projectId: project.id,
    projectName: project.name,
    requesterName: requester.name,
    requesterEmail: requester.email,
    collaboratorId: pendingCollaboratorId,
    ownerEmail: project.owner,
  });

  throw new Error('PENDING_APPROVAL');
}

export async function createProject(
  user: User,
  name: string,
): Promise<ProjectWithFiles> {
  await delay(180);

  const projectName = name.trim() || 'Nouveau projet';
  const project: ProjectWithFiles = {
    id: uuidv4(),
    name: projectName,
    owner: user.email,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
    collaborators: [user],
    files: createDefaultFiles(projectName),
    hasTexFile: true,
  };

  const nextProjects = sortProjectsByActivity([
    project,
    ...readProjectsByOwner(user.email),
  ]);
  writeProjectsByOwner(user.email, nextProjects);
  return project;
}

export async function importProject(
  user: User,
  name: string,
  result: ProjectImportResult,
): Promise<ProjectWithFiles> {
  await delay(220);

  const projectName = name.trim() || 'Projet importé';
  const project: ProjectWithFiles = {
    id: uuidv4(),
    name: projectName,
    owner: user.email,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
    collaborators: [user],
    files:
      result.files.length > 0 ? result.files : createDefaultFiles(projectName),
    imported: true,
    hasTexFile: result.hasTexFile,
  };

  const nextProjects = sortProjectsByActivity([
    project,
    ...readProjectsByOwner(user.email),
  ]);
  writeProjectsByOwner(user.email, nextProjects);
  return project;
}

export async function deleteProject(
  ownerEmail: string,
  projectId: string,
): Promise<void> {
  await delay(120);
  const nextProjects = readProjectsByOwner(ownerEmail).filter(
    (project) => project.id !== projectId,
  );
  writeProjectsByOwner(ownerEmail, nextProjects);
}

export async function renameProject(
  ownerEmail: string,
  projectId: string,
  name: string,
): Promise<ProjectWithFiles | undefined> {
  return updateProjectInStorage(ownerEmail, projectId, (project) => ({
    ...project,
    name,
    updatedAt: new Date().toISOString(),
  }));
}

export async function markProjectAsOpened(
  ownerEmail: string,
  projectId: string,
): Promise<ProjectWithFiles | undefined> {
  return updateProjectInStorage(ownerEmail, projectId, (project) => ({
    ...project,
    lastOpenedAt: new Date().toISOString(),
  }));
}

export async function updateFileContent(
  projectId: string,
  fileId: string,
  content: string,
): Promise<void> {
  const projects = parseStoredProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return;

  const updateInTree = (files: ProjectFile[]): ProjectFile[] =>
    files.map((f) =>
      f.id === fileId
        ? { ...f, content }
        : f.children
          ? { ...f, children: updateInTree(f.children) }
          : f,
    );

  project.files = updateInTree(project.files);
  project.updatedAt = new Date().toISOString();
  persistProjects(projects);
}

export async function replaceProjectFiles(
  ownerEmail: string,
  projectId: string,
  files: ProjectFile[],
): Promise<ProjectWithFiles | undefined> {
  return updateProjectInStorage(ownerEmail, projectId, (project) => ({
    ...project,
    files,
    updatedAt: new Date().toISOString(),
  }));
}

export async function approveCollaborator(
  projectId: string,
  collaboratorId: string,
): Promise<ProjectWithFiles | undefined> {
  const projects = parseStoredProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return undefined;

  const collab = project.collaborators.find(
    (c) => (c as { id?: string }).id === collaboratorId,
  );
  if (collab) {
    (collab as { status?: string }).status = 'approved';
    project.updatedAt = new Date().toISOString();
    persistProjects(projects);
  }

  return project;
}

export async function removeCollaborator(
  projectId: string,
  collaboratorId: string,
): Promise<ProjectWithFiles | undefined> {
  const projects = parseStoredProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return undefined;

  project.collaborators = project.collaborators.filter(
    (c) => (c as { id?: string }).id !== collaboratorId,
  );
  project.updatedAt = new Date().toISOString();
  persistProjects(projects);

  return project;
}

export async function replaceProjectCollaborators(
  ownerEmail: string,
  projectId: string,
  collaborators: Collaborator[],
): Promise<ProjectWithFiles | undefined> {
  return updateProjectInStorage(ownerEmail, projectId, (project) => ({
    ...project,
    collaborators,
  }));
}

export async function importProjectArchive(
  zipFile: File,
): Promise<ProjectImportResult> {
  try {
    const buffer = await zipFile.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const files = parseZipEntries(bytes, decoder);
    const projectFiles: ProjectFile[] = [];
    let hasTexFile = false;

    for (const entry of files) {
      if (entry.isDirectory) continue;

      const nameParts = entry.name.split('/').filter(Boolean);
      const fileName = nameParts[nameParts.length - 1];
      const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

      let fileKind: ProjectFile['type'] = 'image';
      if (ext === 'tex') {
        fileKind = 'tex';
        hasTexFile = true;
      } else if (ext === 'bib') {
        fileKind = 'bib';
      } else if (!SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) {
        continue;
      }

      const content =
        fileKind !== 'image'
          ? decoder.decode(entry.data)
          : `[image: ${fileName}]`;

      projectFiles.push({
        id: uuidv4(),
        name: fileName,
        type: fileKind,
        content,
        createdAt: new Date().toISOString(),
      });
    }

    projectFiles.sort((first, second) => {
      const order: Record<ProjectFile['type'], number> = {
        tex: 0,
        bib: 1,
        image: 2,
        folder: 3,
      };
      return order[first.type] - order[second.type];
    });

    const mainTexId =
      projectFiles.find((file) => file.name === 'main.tex')?.id ??
      projectFiles.find((file) => file.type === 'tex')?.id;

    return { files: projectFiles, hasTexFile, mainTexId };
  } catch {
    return {
      files: createDefaultFiles(zipFile.name.replace(/\.zip$/i, '')),
      hasTexFile: true,
    };
  }
}

export function exportProjectSources(project: ProjectWithFiles): Blob {
  const entries = flattenProjectFiles(project.files);
  const archive = createZipArchive(entries);
  const copy = new Uint8Array(archive.byteLength);
  copy.set(archive);
  const buffer = copy.buffer as ArrayBuffer;
  return new Blob([buffer], { type: 'application/zip' });
}

export function downloadProjectSources(project: ProjectWithFiles): void {
  const archive = exportProjectSources(project);
  const url = URL.createObjectURL(archive);
  const link = document.createElement('a');
  const fileName =
    project.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') ||
    'frelated-project';

  link.href = url;
  link.download = `${fileName.toLowerCase()}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function flattenProjectFiles(
  files: ProjectFile[],
  currentPath = '',
): Array<{ path: string; content: Uint8Array }> {
  const encoder = new TextEncoder();
  const entries: Array<{ path: string; content: Uint8Array }> = [];

  for (const file of files) {
    const nextPath = currentPath ? `${currentPath}/${file.name}` : file.name;

    if (file.type === 'folder') {
      entries.push(...flattenProjectFiles(file.children ?? [], nextPath));
      continue;
    }

    const content = file.content ?? '';
    entries.push({ path: nextPath, content: encoder.encode(content) });
  }

  return entries;
}

function createZipArchive(
  entries: Array<{ path: string; content: Uint8Array }>,
): Uint8Array {
  const encoder = new TextEncoder();
  const now = new Date();
  const fileRecords: Array<{
    localHeaderOffset: number;
    fileName: Uint8Array;
    crc32: number;
    size: number;
    modTime: number;
    modDate: number;
  }> = [];
  const localFileChunks: Uint8Array[] = [];
  let localSectionSize = 0;

  for (const entry of entries) {
    const fileName = encoder.encode(entry.path);
    const crc32 = computeCrc32(entry.content);
    const modTime = createDosTime(now);
    const modDate = createDosDate(now);

    const localHeader = new Uint8Array(30 + fileName.length);
    const localView = new DataView(localHeader.buffer);

    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, modTime, true);
    localView.setUint16(12, modDate, true);
    localView.setUint32(14, crc32, true);
    localView.setUint32(18, entry.content.length, true);
    localView.setUint32(22, entry.content.length, true);
    localView.setUint16(26, fileName.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(fileName, 30);

    fileRecords.push({
      localHeaderOffset: localSectionSize,
      fileName,
      crc32,
      size: entry.content.length,
      modTime,
      modDate,
    });

    localFileChunks.push(localHeader, entry.content);
    localSectionSize += localHeader.length + entry.content.length;
  }

  const centralDirectoryChunks: Uint8Array[] = [];
  let centralDirectorySize = 0;

  for (const record of fileRecords) {
    const centralHeader = new Uint8Array(46 + record.fileName.length);
    const centralView = new DataView(centralHeader.buffer);

    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, record.modTime, true);
    centralView.setUint16(14, record.modDate, true);
    centralView.setUint32(16, record.crc32, true);
    centralView.setUint32(20, record.size, true);
    centralView.setUint32(24, record.size, true);
    centralView.setUint16(28, record.fileName.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, record.localHeaderOffset, true);
    centralHeader.set(record.fileName, 46);

    centralDirectoryChunks.push(centralHeader);
    centralDirectorySize += centralHeader.length;
  }

  const endOfCentralDirectory = new Uint8Array(22);
  const endView = new DataView(endOfCentralDirectory.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, fileRecords.length, true);
  endView.setUint16(10, fileRecords.length, true);
  endView.setUint32(12, centralDirectorySize, true);
  endView.setUint32(16, localSectionSize, true);
  endView.setUint16(20, 0, true);

  const archiveChunks = [
    ...localFileChunks,
    ...centralDirectoryChunks,
    endOfCentralDirectory,
  ];
  const totalSize = archiveChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const archive = new Uint8Array(totalSize);
  let offset = 0;

  for (const chunk of archiveChunks) {
    archive.set(chunk, offset);
    offset += chunk.length;
  }

  return archive;
}

function createDosTime(date: Date): number {
  return (
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2)
  );
}

function createDosDate(date: Date): number {
  return (
    ((Math.max(date.getFullYear(), 1980) - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate()
  );
}

function computeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;

  for (const value of data) {
    crc = CRC32_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let crc = index;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }

    table[index] = crc >>> 0;
  }

  return table;
})();

function parseZipEntries(bytes: Uint8Array, decoder: TextDecoder): ZipEntry[] {
  const entries: ZipEntry[] = [];
  const view = new DataView(bytes.buffer);
  let offset = 0;

  while (offset < bytes.length - 4) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break;

    const flags = view.getUint16(offset + 6, true);
    const compression = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(
      bytes.slice(offset + 30, offset + 30 + nameLength),
    );

    const dataOffset = offset + 30 + nameLength + extraLength;
    const isDirectory =
      name.endsWith('/') || (uncompressedSize === 0 && compressedSize === 0);

    if (!isDirectory) {
      let data: Uint8Array;

      if (compression === 0) {
        data = bytes.slice(dataOffset, dataOffset + compressedSize);
      } else {
        data = new Uint8Array(0);
      }

      entries.push({ name, data, isDirectory: false });
    } else {
      entries.push({ name, data: new Uint8Array(0), isDirectory: true });
    }

    offset = dataOffset + compressedSize;
    if (flags & 0x08) offset += 16;
  }

  return entries;
}
