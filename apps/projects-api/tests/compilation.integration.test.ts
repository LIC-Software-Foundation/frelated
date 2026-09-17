// Run with COMPILATION_INTEGRATION=1, Redis, and a TeX-enabled worker image.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import websocket from '@fastify/websocket';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import type { ProjectRecord } from '../src/domain/models';

const projectId = randomUUID();
let project: ProjectRecord;
vi.mock('../src/services/projects.service', () => ({
  projectsService: {
    getCompilationProject: async (
      user: { email: string },
      id: string,
      edit = false,
    ) => {
      if (
        id !== projectId ||
        user.email === 'stranger' ||
        (edit && user.email === 'viewer')
      )
        throw new Error('FORBIDDEN');
      return project;
    },
  },
}));
vi.mock('../src/services/auth.service', () => ({
  authService: {
    findUserByEmail: async (email: string) => ({ id: email, email }),
  },
}));
vi.mock('../src/services/tokens', () => ({
  verifyToken: (token: string) => (token === 'bad' ? null : { email: token }),
}));
const enabled = process.env.COMPILATION_INTEGRATION === '1';
describe.skipIf(!enabled)('Distributed LaTeX compilation', () => {
  const app = Fastify();
  let redis: Redis;
  let worker: ChildProcess;
  const headers = { authorization: 'Bearer owner' };
  const base = `/projects/${projectId}/compilation`;
  const document = (body: string) =>
    `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}`;
  beforeAll(async () => {
    project = {
      id: projectId,
      name: 'Test',
      owner: 'owner',
      createdAt: '',
      collaborators: [],
      files: [
        {
          id: 'main',
          name: 'main.tex',
          type: 'tex',
          content: document('Hello compilation'),
          createdAt: '',
        },
      ],
    };
    redis = new Redis(process.env.REDIS_URL!);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ contents: {} }) })),
    );
    await app.register(websocket);
    app.decorate(
      'authenticate',
      async (request: FastifyRequest, reply: FastifyReply) => {
        if (!request.headers.authorization) return reply.code(401).send();
        request.currentUser = {
          id: 'test',
          name: 'Test',
          joinedAt: '',
          email: request.headers.authorization.replace('Bearer ', ''),
        };
      },
    );
    const { default: routes } = await import('../src/routes/compilation');
    await app.register(routes, { prefix: '/projects' });
    await app.ready();
    worker = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/compilation/worker.ts'],
      {
        env: { ...process.env, COMPILATION_TIMEOUT_MS: '30000' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    worker.stderr?.on('data', () => {});
  }, 30000);
  afterAll(async () => {
    worker?.kill('SIGTERM');
    await app.close();
    await redis?.del(
      `compilation:${projectId}`,
      `compilation:${projectId}:sequence`,
    );
    await redis?.quit();
    vi.unstubAllGlobals();
  });
  const read = async () => (await app.inject({ url: base, headers })).json();
  const wait = async () => {
    for (let i = 0; i < 180; i++) {
      const state = await read();
      if (state.status !== 'compiling') return state;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Compilation timeout');
  };
  it('protects submissions, state and PDF against unauthorized users', async () => {
    expect((await app.inject({ url: base })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: base,
          headers: { authorization: 'Bearer stranger' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: base,
          headers: { authorization: 'Bearer viewer' },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: base + '/pdf',
          headers: { authorization: 'Bearer stranger' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('returns a job immediately, broadcasts to two clients, serves a real PDF and reuses an unchanged result', async () => {
    const a = await app.injectWS(base + '/events');
    const b = await app.injectWS(base + '/events');
    const eventsA: { status: string }[] = [];
    const eventsB: { status: string }[] = [];
    a.on('message', (data) => eventsA.push(JSON.parse(data.toString())));
    b.on('message', (data) => eventsB.push(JSON.parse(data.toString())));
    a.send(JSON.stringify({ token: 'owner' }));
    b.send(JSON.stringify({ token: 'viewer' }));
    const submitted = await app.inject({
      method: 'POST',
      url: base,
      headers,
      payload: {},
    });
    expect(submitted.statusCode).toBe(202);
    expect(submitted.json().jobId).toBeTruthy();
    const result = await wait();
    expect(result.status, JSON.stringify(result.logs)).toBe('success');
    const pdf = await app.inject({ url: base + '/pdf', headers });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    await vi.waitFor(
      () => {
        expect(eventsA.some((e) => e.status === 'success')).toBe(true);
        expect(eventsB.some((e) => e.status === 'success')).toBe(true);
      },
      { timeout: 12000 },
    );
    const unchanged = await app.inject({
      method: 'POST',
      url: base,
      headers,
      payload: { onlyIfChanged: true },
    });
    expect(unchanged.json().jobId).toBe(result.jobId);
    a.close();
    b.close();
  }, 100000);
  it('keeps the successful PDF when LaTeX fails', async () => {
    const old = await read();
    project.files[0].content = document('\\undefinedcommand');
    await app.inject({ method: 'POST', url: base, headers, payload: {} });
    const result = await wait();
    expect(result.status).toBe('error');
    expect(result.pdfJobId).toBe(old.pdfJobId);
    expect(result.logs[0].message).toContain('Undefined control sequence');
  }, 100000);
  it('generates a PDF with a placeholder when an image is missing', async () => {
    project.files[0].content = String.raw`\documentclass{article}
\usepackage{graphicx}
\begin{document}
Avant\par\includegraphics{image-absente.png}\par Après
\end{document}`;
    await app.inject({ method: 'POST', url: base, headers, payload: {} });
    const result = await wait();
    expect(result.status, JSON.stringify(result.logs)).toBe('success');
    expect(result.logs[0].level).toBe('warning');
    expect(result.logs[0].message).toContain('image-absente.png');
    expect(result.logs[0].message).toContain('emplacement de substitution');
    const pdf = await app.inject({ url: base + '/pdf', headers });
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  }, 100000);
  it.each(['xelatex', 'lualatex'])(
    'compiles with %s',
    async (engine) => {
      project.files[0].content =
        engine === 'xelatex'
          ? String.raw`\documentclass{article}
\usepackage{fontspec}
\usepackage{fontawesome5}
\setmainfont{Liberation Sans}
\begin{document}
Unicode café — \textbf{Gras} et \textit{italique}. \faGithub
\end{document}`
          : document('Unicode café');
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: base + '/settings',
            headers,
            payload: { mainFile: 'main.tex', engine },
          })
        ).statusCode,
      ).toBe(200);
      await app.inject({ method: 'POST', url: base, headers, payload: {} });
      const result = await wait();
      expect(result.status, JSON.stringify(result.logs)).toBe('success');
    },
    100000,
  );
  it.each(['bibtex', 'biber'])(
    'resolves bibliographies with %s',
    async (backend) => {
      project.files = [
        {
          id: 'main',
          name: 'main.tex',
          type: 'tex',
          createdAt: '',
          content:
            backend === 'biber'
              ? '\\documentclass{article}\n\\usepackage[backend=biber]{biblatex}\n\\addbibresource{references.bib}\n\\begin{document}\nCitation \\cite{sample}.\n\\printbibliography\n\\end{document}'
              : document(
                  'Citation \\cite{sample}.\n\\bibliographystyle{plain}\n\\bibliography{references}',
                ),
        },
        {
          id: 'bib',
          name: 'references.bib',
          type: 'bib',
          createdAt: '',
          content:
            '@book{sample, author={Ada Lovelace}, title={Notes}, year={1843}, publisher={Test}}',
        },
      ];
      await app.inject({
        method: 'PUT',
        url: base + '/settings',
        headers,
        payload: { mainFile: 'main.tex', engine: 'pdflatex' },
      });
      await app.inject({ method: 'POST', url: base, headers, payload: {} });
      const result = await wait();
      expect(result.status, JSON.stringify(result.logs)).toBe('success');
      expect(result.logs[0].message.toLowerCase()).toContain(backend);
    },
    100000,
  );

  it('supersedes a queued revision with the latest sources', async () => {
    project.files[0].content = document('Old revision');
    const a = (
      await app.inject({ method: 'POST', url: base, headers, payload: {} })
    ).json();
    project.files[0].content = document('Latest revision');
    const b = (
      await app.inject({ method: 'POST', url: base, headers, payload: {} })
    ).json();
    expect(b.revision).toBeGreaterThan(a.revision);
    const result = await wait();
    expect(result.pdfJobId).toBe(b.jobId);
  }, 100000);
});
