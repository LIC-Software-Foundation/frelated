import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrivalOffsets, readConfig, validatePlan } from './config.mjs';
import { memoryBytes } from './collect.mjs';
import { buildSummary, percentile, statistics, csv } from './report.mjs';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const script = path.join(root, 'scripts/compilation-benchmark.mjs');
const exec = promisify(execFile);

test('plans: fixed arrival rate, burst and invalid configuration', async () => {
  const [phase] = validatePlan([
    { name: 'load', durationSeconds: 2.5, burst: 2, ratePerSecond: 2 },
  ]);
  assert.deepEqual(arrivalOffsets(phase), [0, 0, 0, 500, 1000, 1500, 2000]);
  for (const input of [
    [],
    [{ name: 'x', durationSeconds: 0 }],
    [{ name: 'x', durationSeconds: 1, ratePerSecond: -1 }],
    [
      { name: 'x', durationSeconds: 1 },
      { name: 'x', durationSeconds: 1 },
    ],
  ])
    assert.throws(() => validatePlan(input));
  await assert.rejects(readConfig(root, ['--max-in-flight', '0']));
  await assert.rejects(
    readConfig(root, ['--api-url', 'http://user:secret@localhost']),
  );
});

test('statistics keep missing timings unknown and distinguish failures from skipped arrivals', () => {
  assert.equal(percentile([null, 10, 50, 20, undefined], 0.95), 50);
  assert.equal(percentile([], 0.5), null);
  const stats = statistics([
    {
      outcome: 'success',
      compileMs: 15,
      endToEndMs: 100,
      queueWaitMs: 60,
      jobId: 'a',
    },
    { outcome: 'success', compileMs: 20, endToEndMs: 200, jobId: 'b' },
    { outcome: 'timeout', jobId: 'c' },
    { outcome: 'skipped_capacity' },
  ]);
  assert.equal(stats.accepted, 3);
  assert.equal(stats.failed, 1);
  assert.equal(stats.skipped, 1);
  assert.equal(stats.queueWaitMs.count, 1);
  assert.equal(stats.queueWaitMs.p95, 60);
  assert.equal(stats.errorRate, 1 / 3);
  assert.equal(stats.successRate, 2 / 3);
  assert.equal(stats.acceptedFailed, 1);
  assert.equal(stats.failureCounts.timeout, 1);
  const empty = statistics([]);
  assert.equal(empty.errorRate, null);
  assert.equal(empty.successRate, null);
  assert.equal(memoryBytes('1.5GiB'), 1.5 * 1024 ** 3);
  assert.equal(memoryBytes('bad'), null);
  assert.match(csv([{ name: '=CMD("x")' }], ['name']), /'=CMD\(""x""\)/u);
});

test('summary distinguishes complete run, warmup and measurement with explicit error denominators', () => {
  const summary = buildSummary({
    jobs: [
      { warmup: true, outcome: 'success', jobId: 'warmup' },
      { outcome: 'success', jobId: 'success', submittedAt: 1 },
      { outcome: 'compilation_error', jobId: 'failed', submittedAt: 2 },
      { outcome: 'request_error' },
      { outcome: 'skipped_capacity' },
    ],
    phases: [],
    samples: [],
  });
  assert.equal(summary.total.attempted, 4);
  assert.equal(summary.total.accepted, 3);
  assert.equal(summary.total.success, 2);
  assert.equal(summary.total.failed, 2);
  assert.equal(summary.total.errorRate, 0.5);
  assert.equal(summary.total.notAcceptedFailed, 1);
  assert.equal(summary.warmup.success, 1);
  assert.equal(summary.success, 1);
  assert.equal(summary.submitted, 2);
  assert.equal(summary.errorRate, 2 / 3);
  assert.equal(summary.skipped, 1);
});

async function fixture(
  t,
  {
    mode = 'success',
    plan,
    maxInFlight = 2,
    maxJobs = 20,
    signal = false,
    docker = false,
    pdf = false,
    pdfFailure = false,
  } = {},
) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'compilation-benchmark-test-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const projects = new Map([['unrelated', { id: 'unrelated' }]]);
  let sequence = 0;
  let submissions = 0;
  let replacements = 0;
  let processHandle;
  let interrupted = false;
  const server = createServer(async (req, res) => {
    try {
      let body = '';
      for await (const part of req) body += part;
      const input = body ? JSON.parse(body) : null;
      const json = (value, code = 200) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      const active = [...projects.values()].filter(
        (project) =>
          project.pending &&
          (mode === 'timeout' || Date.now() < project.readyAt),
      ).length;
      if (req.url === '/auth/login')
        return json({ token: 'test-token-never-export' });
      if (req.url === '/auth/me') {
        assert.equal(
          req.headers.authorization,
          'Bearer test-token-never-export',
        );
        return json({ user: { id: 'test-user' } });
      }
      if (req.url === '/internal/queue/metrics') {
        assert.equal(
          req.headers.authorization,
          'Bearer test-autoscaler-secret',
        );
        if (mode === 'preflight') return json({ message: 'unavailable' }, 503);
        return json({
          available: true,
          waitingCount: 0,
          activeCount: active,
          heavyWaitingCount: 0,
          delayedCount: 0,
          oldestWaitingJobAgeMs: 0,
        });
      }
      if (req.url === '/status')
        return json({
          lastDecision: { type: 'hold', reason: 'test' },
          lastError: null,
        });
      if (req.url === '/projects' && req.method === 'POST') {
        const project = {
          id: `project-${++sequence}`,
          files: input.files,
          pending: false,
        };
        projects.set(project.id, project);
        return json({ project }, 201);
      }
      const parts = req.url.split('/').filter(Boolean);
      const project = projects.get(parts[1]);
      if (!project) return json({ message: 'missing' }, 404);
      if (parts.length === 2 && req.method === 'DELETE') {
        projects.delete(project.id);
        res.writeHead(204).end();
        return;
      }
      if (parts[2] === 'files' && req.method === 'PATCH') {
        assert.match(input.content, /% benchmark/u);
        res.writeHead(204).end();
        return;
      }
      if (parts[2] === 'compilation' && req.method === 'POST') {
        if (project.pending && Date.now() < project.readyAt) replacements++;
        project.jobId = `job-${++submissions}`;
        project.pending = true;
        project.readyAt = Date.now() + 25;
        if (signal && !interrupted) {
          interrupted = true;
          setTimeout(() => processHandle.kill('SIGINT'), 5);
        }
        return json({ jobId: project.jobId, status: 'compiling' }, 202);
      }
      if (parts[3] === 'pdf') {
        if (mode === 'bad-pdf') return res.end('invalid');
        return res.end('%PDF-1.7\nfixture');
      }
      const done = mode !== 'timeout' && Date.now() >= project.readyAt;
      return json({
        jobId: project.jobId,
        pdfJobId: project.jobId,
        status: done
          ? mode === 'compile-error'
            ? 'error'
            : 'success'
          : 'compiling',
        durationMs: 5,
        compiledAt: new Date().toISOString(),
      });
    } catch (error) {
      res.writeHead(500).end(error.message);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const planPath = path.join(directory, 'plan.json');
  await writeFile(
    planPath,
    JSON.stringify(
      plan ?? [
        { name: 'warmup', durationSeconds: 0.15, burst: 1, warmup: true },
        { name: '<baseline>', durationSeconds: 0.15, burst: 2 },
      ],
    ),
  );
  if (docker) {
    const fakeDocker = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'ps') console.log(JSON.stringify({ID:'worker-id',Names:'worker',Labels:'com.docker.compose.service=compilation-worker'}));
else if (args[0] === 'stats') console.log(JSON.stringify({ID:'worker-id',Name:'worker',CPUPerc:'15.0%',MemUsage:'25MiB / 768MiB'}));
else { const evalIndex=args.indexOf('EVAL'); const count=Number(args[evalIndex+2]); console.log(JSON.stringify(Array.from({length:count},()=>['1000','1010','1040']))); }
`;
    await writeFile(path.join(directory, 'docker'), fakeDocker);
    await chmod(path.join(directory, 'docker'), 0o755);
  }
  const output = path.join(directory, 'output');
  const pdfBrowser = path.join(directory, 'fake-chrome');
  if (pdf && !pdfFailure) {
    await writeFile(
      pdfBrowser,
      `#!/usr/bin/env node
const {writeFileSync} = require('node:fs');
const args = process.argv.slice(2);
const output = args.find(arg => arg.startsWith('--print-to-pdf=')).slice('--print-to-pdf='.length);
if (!args.includes('--headless') || !args.at(-1).startsWith('file:')) process.exit(2);
writeFileSync(output, '%PDF-1.7\\nfixture');
`,
    );
    await chmod(pdfBrowser, 0o755);
  }
  processHandle = spawn(
    process.execPath,
    [
      script,
      '--plan',
      planPath,
      '--api-url',
      url,
      '--queue-url',
      url,
      '--autoscaler-url',
      url,
      '--output',
      output,
      '--max-in-flight',
      String(maxInFlight),
      '--max-jobs',
      String(maxJobs),
      '--sample-ms',
      '25',
      '--poll-ms',
      '5',
      '--recovery-seconds',
      '0.8',
      '--job-timeout-seconds',
      mode === 'timeout' ? '0.12' : '2',
      ...(docker ? [] : ['--no-docker']),
      ...(pdf ? ['--pdf-browser', pdfBrowser] : ['--no-pdf']),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        BENCHMARK_TOKEN: '',
        BENCHMARK_AUTOSCALER_TOKEN: 'test-autoscaler-secret',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let logs = '';
  processHandle.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  processHandle.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    processHandle.on('error', reject);
    processHandle.on('exit', resolve);
  });
  const reportText = await readFile(
    path.join(output, 'report.json'),
    'utf8',
  ).catch((error) => {
    throw new Error(`${error.message}\n${logs}`);
  });
  assert(!reportText.includes('test-token-never-export'));
  assert(!reportText.includes('test-autoscaler-secret'));
  assert.deepEqual([...projects.keys()], ['unrelated'], logs);
  assert.equal(replacements, 0);
  return { report: JSON.parse(reportText), code, logs, output };
}

test(
  'full API run: PDF verification, Docker metrics, exact queue timings, exports and cleanup',
  { timeout: 10_000 },
  async (t) => {
    const { report, code, logs, output } = await fixture(t, {
      docker: true,
      pdf: true,
    });
    assert.equal(code, 0, logs);
    assert.equal(report.summary.success, 2);
    assert.equal(report.summary.total.success, 3);
    assert.equal(report.summary.warmup.success, 1);
    assert.equal(report.summary.total.errorRate, 0);
    assert.equal(report.jobs.length, 3);
    assert.equal(report.summary.queueWaitMs.p95, 10);
    assert.equal(report.summary.workerProcessingMs.p95, 30);
    assert.equal(report.summary.maxWorkers, 1);
    assert.equal(report.recoveryReached, true);
    const html = await readFile(path.join(output, 'report.html'), 'utf8');
    assert(html.includes('&lt;baseline&gt;'));
    assert(!html.includes('<baseline>'));
    assert(html.includes('Bilan des compilations'));
    assert(html.includes('Taux d’erreurs'));
    assert(
      html.includes(
        'Mesure d’attente disponible pour 2 compilations réussies sur 2',
      ),
    );
    assert(!html.includes('2/2 succès hors échauffement'));
    assert(html.includes('href="report.pdf"'));
    assert.equal(report.exports.pdf.status, 'generated');
    assert.equal(
      (await readFile(path.join(output, 'report.pdf')))
        .subarray(0, 5)
        .toString(),
      '%PDF-',
    );
    assert.match(
      await readFile(path.join(output, 'summary.csv'), 'utf8'),
      /errorRatePercent/u,
    );
    assert.match(
      await readFile(path.join(output, 'jobs.csv'), 'utf8'),
      /queueWaitMs/u,
    );
    assert.match(
      await readFile(path.join(output, 'samples.csv'), 'utf8'),
      /workerCount/u,
    );
  },
);

test(
  'PDF errors preserve HTML/data and return a failure status',
  { timeout: 10_000 },
  async (t) => {
    const { report, code, logs, output } = await fixture(t, {
      pdf: true,
      pdfFailure: true,
      plan: [{ name: 'load', durationSeconds: 0.1, burst: 1 }],
    });
    assert.equal(code, 1, logs);
    assert.equal(report.summary.success, 1);
    assert.equal(report.exports.pdf.status, 'failed');
    assert.match(report.exports.pdf.error, /Chrome\/Chromium introuvable/u);
    const html = await readFile(path.join(output, 'report.html'), 'utf8');
    assert(html.includes('Chrome/Chromium introuvable'));
    assert(!html.includes('href="report.pdf"'));
  },
);

test(
  'report-only regenerates an existing run without contacting the compilation API',
  { timeout: 10_000 },
  async (t) => {
    const { output, report } = await fixture(t);
    const result = await exec(
      process.execPath,
      [
        script,
        '--report-only',
        path.join(output, 'report.json'),
        '--no-pdf',
        '--api-url',
        'http://127.0.0.1:1',
      ],
      { cwd: root, timeout: 5000 },
    );
    assert.match(result.stdout, /Bilan complet/u);
    const regenerated = JSON.parse(
      await readFile(path.join(output, 'report.json'), 'utf8'),
    );
    assert.equal(regenerated.runId, report.runId);
    assert.equal(regenerated.jobs.length, report.jobs.length);
    assert.equal(regenerated.summary.total.success, 3);
    assert.equal(regenerated.exports.pdf.status, 'disabled');
  },
);

test(
  'generator saturation counts skipped arrivals and does not replace running revisions',
  { timeout: 10_000 },
  async (t) => {
    const { report, code, logs } = await fixture(t, {
      plan: [{ name: 'burst', durationSeconds: 0.1, burst: 10 }],
      maxInFlight: 2,
    });
    assert.equal(code, 1, logs);
    assert.equal(report.summary.success, 2);
    assert.equal(report.summary.skipped, 8);
    assert.equal(report.summary.failed, 0);
    assert.equal(report.summary.queueWaitMs.p95, null);
  },
);

test(
  'timeouts retire projects and still export errors and clean up',
  { timeout: 10_000 },
  async (t) => {
    const { report, code, logs } = await fixture(t, {
      mode: 'timeout',
      plan: [{ name: 'load', durationSeconds: 0.3, ratePerSecond: 5 }],
      maxInFlight: 1,
    });
    assert.equal(code, 1, logs);
    assert.equal(report.jobs[0].outcome, 'timeout');
    assert.equal(report.jobs[1].outcome, 'skipped_capacity');
  },
);

test(
  'compiler errors and invalid PDFs are counted as failures',
  { timeout: 10_000 },
  async (t) => {
    for (const mode of ['compile-error', 'bad-pdf']) {
      const { report, code, logs } = await fixture(t, {
        mode,
        plan: [{ name: 'load', durationSeconds: 0.1, burst: 1 }],
      });
      assert.equal(code, 1, logs);
      assert.equal(
        report.jobs[0].outcome,
        mode === 'compile-error' ? 'compilation_error' : 'pdf_error',
      );
      assert.equal(report.summary.success, 0);
    }
  },
);

test(
  'failed preflight leaves existing projects untouched and produces a report',
  { timeout: 10_000 },
  async (t) => {
    const { report, code } = await fixture(t, { mode: 'preflight' });
    assert.equal(code, 1);
    assert.match(report.fatalError, /Précontrôle/u);
    assert.equal(report.jobs.length, 0);
  },
);

test(
  'SIGINT stops submissions, drains, exports and deletes only benchmark projects',
  { timeout: 10_000 },
  async (t) => {
    const { report, code, logs } = await fixture(t, {
      signal: true,
      plan: [{ name: 'load', durationSeconds: 5, ratePerSecond: 10 }],
    });
    assert.equal(code, 130, logs);
    assert.equal(report.interrupted, true);
    assert.equal(report.jobs.length, 1);
    assert.equal(report.jobs[0].outcome, 'success');
  },
);
