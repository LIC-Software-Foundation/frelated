import { randomUUID } from 'node:crypto';
import {
  ApiUser,
  DataStoreShape,
  ProjectCollaborator,
  ProjectFile,
  ProjectRecord,
  StoredUser,
} from '../domain/models';

const now = new Date().toISOString();
export const DEFAULT_SEED_PASSWORD = 'frelated123';

export const seedUserDefinitions: Array<
  Pick<ApiUser, 'name' | 'email'> & { organization?: string }
> = [
  {
    name: 'Regent',
    email: 'regent@frelated.dev',
    organization: 'Frelated Research Lab',
  },
  {
    name: 'Vergez',
    email: 'vergez@frelated.dev',
    organization: 'Frelated Research Lab',
  },
  {
    name: 'Hamed',
    email: 'hamed@frelated.dev',
    organization: 'Frelated Research Lab',
  },
];

const createUser = (
  input: Pick<ApiUser, 'name' | 'email'> & {
    passwordHash?: string;
    passwordSalt?: string;
    password?: string;
    organization?: string;
  },
): StoredUser => ({
  id: randomUUID(),
  name: input.name,
  email: input.email,
  joinedAt: now,
  passwordHash: input.passwordHash || '',
  passwordSalt: input.passwordSalt || '',
  organization: input.organization,
});

const createCollaborator = (
  user: ApiUser,
  role: ProjectCollaborator['role'],
): ProjectCollaborator => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role,
  isOnline: false,
});

const createDefaultFiles = (projectName: string): ProjectFile[] => [
  {
    id: randomUUID(),
    name: 'main.tex',
    type: 'tex',
    createdAt: now,
    content: `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}

\\title{${projectName}}
\\author{Frelated}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}
Bienvenue sur Frelated.

\\end{document}`,
  },
  {
    id: randomUUID(),
    name: 'references.bib',
    type: 'bib',
    createdAt: now,
    content: '',
  },
  {
    id: randomUUID(),
    name: 'figures',
    type: 'folder',
    createdAt: now,
    children: [],
  },
];

export const seedUsers = (): StoredUser[] => [
  ...seedUserDefinitions.map((user) => createUser(user)),
];

export const seedProjects = (users: StoredUser[]): ProjectRecord[] => {
  const owner = users[0];
  const editor = users[1];
  const viewer = users[2];

  return [
    {
      id: randomUUID(),
      name: 'Article collaboratif Frelated',
      owner: owner.email,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      collaborators: [
        createCollaborator(owner, 'owner'),
        createCollaborator(editor, 'editor'),
        createCollaborator(viewer, 'viewer'),
      ],
      files: createDefaultFiles('Article collaboratif Frelated'),
      hasTexFile: true,
    },
  ];
};

export const createSeedStore = (): DataStoreShape => {
  const users = seedUsers();
  return {
    users,
    projects: seedProjects(users),
  };
};
