import { spawn } from 'node:child_process';
import { mkdir, appendFile, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readConfig, arrivalOffsets } from './compilation-benchmark/config.mjs';
import {
  fleetSnapshot,
  hostSnapshot,
  collectQueueTimings,
} from './compilation-benchmark/collect.mjs';
import { writeReports } from './compilation-benchmark/report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function printResults(config, result) {
  const { total } = result.summary;
  console.log(
    `Bilan complet (échauffement inclus) : ${total.accepted} compilation(s) lancée(s), ${total.success} réussie(s), ${total.failed} échouée(s), ${total.skipped} demande(s) non soumise(s).`,
  );
  console.log(
    `Taux d’erreurs : ${total.errorRate === null ? 'non disponible' : `${(total.errorRate * 100).toFixed(2)} %`} (${total.failed} échec(s) / ${total.attempted} tentative(s)).`,
  );
  console.log(`Rapport HTML : ${path.join(config.output, 'report.html')}`);
  if (result.pdf.status === 'generated')
    console.log(`Rapport PDF : ${path.join(config.output, 'report.pdf')}`);
  else if (result.pdf.status === 'failed') {
    console.error(result.pdf.error);
    process.exitCode = 1;
  }
}

async function main() {
  let config = await readConfig(root);
  if (!config) return;
  const exportOptions = () => ({
    pdf: config.pdf,
    browserPath: config.pdfBrowser,
    timeoutMs: config.pdfTimeoutMs,
    noSandbox: config.pdfNoSandbox,
  });
  if (config.reportOnly) {
    const report = JSON.parse(await readFile(config.reportOnly, 'utf8'));
    if (
      !['jobs', 'samples', 'phases', 'warnings', 'cleanupFailures'].every(
        (key) => Array.isArray(report[key]),
      ) ||
      !report.config
    )
      throw new Error(
        '--report-only attend un report.json complet produit par le benchmark.',
      );
    await mkdir(config.output, { recursive: true });
    const result = await writeReports(config.output, report, exportOptions());
    printResults(config, result);
    return;
  }
  if (config.startStack) {
    if (config.envFile !== path.join(root, '.env.docker'))
      throw new Error(
        '--start-stack utilise .env.docker via run-docker.sh. Pour un autre --env-file, démarre Compose séparément.',
      );
    console.log('Démarrage de la stack Docker…');
    await new Promise((resolve, reject) => {
      const child = spawn('bash', ['run-docker.sh', 'up'], {
        cwd: root,
        stdio: 'inherit',
      });
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Démarrage Docker : code ${code}.`)),
      );
    });
    // run-docker.sh can create .env.docker from its example on first run.
    config = await readConfig(root);
  }

  const report = {
    runId: randomUUID(),
    startedAt: new Date().toISOString(),
    config: {
      plan: config.plan,
      apiUrl: config.apiUrl,
      queueUrl: config.queueUrl,
      autoscalerUrl: config.autoscalerUrl,
      queueName: config.queueName,
      maxInFlight: config.maxInFlight,
      maxJobs: config.maxJobs,
      sampleMs: config.sampleMs,
      pollMs: config.pollMs,
      jobTimeoutMs: config.jobTimeoutMs,
      recoveryMs: config.recoveryMs,
      minWorkers: config.minWorkers,
      docker: config.docker,
      queueTimings: config.queueTimings,
      sourceBytes: Buffer.byteLength(config.source),
    },
    phases: [],
    jobs: [],
    samples: [],
    warnings: [],
    cleanupFailures: [],
    interrupted: false,
  };
  await mkdir(config.output, { recursive: true });
  const warn = (message) => {
    if (!report.warnings.includes(message)) {
      report.warnings.push(message);
      console.warn(`Attention : ${message}`);
    }
  };
  let stopping = false;
  const interrupt = () => {
    if (!stopping)
      console.log(
        '\nArrêt des soumissions ; drainage borné, rapport et nettoyage en cours…',
      );
    stopping = true;
    report.interrupted = true;
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const projects = [];
  const running = new Set();
  let token = config.token;
  let phaseName = 'setup';
  let sampling = false;
  let sampler;
  let attempts = 0;
  let exportResult;

  async function request(
    base,
    route,
    {
      method = 'GET',
      body,
      internal = false,
      timeoutMs = config.requestTimeoutMs,
      pdf = false,
    } = {},
  ) {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: {
        ...(internal
          ? { authorization: `Bearer ${config.autoscalerToken}` }
          : token
            ? { authorization: `Bearer ${token}` }
            : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs))),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status} : ${method} ${route}`);
    }
    if (pdf) {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.subarray(0, 5).toString() !== '%PDF-')
        throw new Error('Réponse PDF invalide.');
      return buffer.length;
    }
    return response.status === 204 ? null : response.json();
  }
  const api = (route, options) => request(config.apiUrl, route, options);

  async function sample() {
    const sampleStartedAt = Date.now();
    const row = {
      at: sampleStartedAt,
      phase: phaseName,
      localInFlight: running.size,
      errors: [],
    };
    const results = await Promise.allSettled([
      request(config.queueUrl, '/internal/queue/metrics', { internal: true }),
      request(config.autoscalerUrl, '/status', { internal: true }),
      config.docker ? fleetSnapshot(config) : Promise.resolve(null),
      hostSnapshot(),
    ]);
    for (const [index, key] of [
      'queue',
      'autoscaler',
      'fleet',
      'host',
    ].entries()) {
      const result = results[index];
      if (result.status === 'fulfilled') row[key] = result.value;
      else {
        row[key] = null;
        row.errors.push(key);
        warn(
          `Collecte ${key} indisponible ; voir les lacunes dans samples.jsonl.`,
        );
      }
    }
    row.collectionMs = Date.now() - sampleStartedAt;
    report.samples.push(row);
    await appendFile(
      path.join(config.output, 'samples.jsonl'),
      `${JSON.stringify(row)}\n`,
    );
    const workerCount = row.fleet?.workerCount ?? '?';
    console.log(
      `[${row.phase}] attente=${row.queue?.waitingCount ?? '?'} actifs=${row.queue?.activeCount ?? '?'} workers=${workerCount} en-vol=${running.size} décision=${row.autoscaler?.lastDecision?.type ?? '?'}`,
    );
    return row;
  }

  async function runJob(project, job) {
    const compilationPath = `/projects/${project.id}/compilation`;
    const deadline = Date.now() + config.jobTimeoutMs;
    const bounded = (options = {}) => ({
      ...options,
      timeoutMs: Math.min(
        config.requestTimeoutMs,
        Math.max(1, deadline - Date.now()),
      ),
    });
    try {
      job.preparationStartedAt = Date.now();
      await api(
        `/projects/${project.id}/files/${project.fileId}`,
        bounded({
          method: 'PATCH',
          body: {
            content: `${config.source}\n% benchmark ${report.runId} ${job.index}\n`,
          },
        }),
      );
      job.submittedAt = Date.now();
      const accepted = await api(
        compilationPath,
        bounded({ method: 'POST', body: { onlyIfChanged: false } }),
      );
      job.acceptedAt = Date.now();
      if (!accepted.jobId)
        throw new Error('La soumission ne retourne aucun jobId.');
      job.jobId = accepted.jobId;
      let state = accepted;
      while (true) {
        if (Date.now() >= deadline) {
          job.outcome = 'timeout';
          throw new Error('Délai total par job dépassé.');
        }
        if (state.jobId !== job.jobId) {
          job.outcome = 'superseded';
          throw new Error('Révision remplacée pendant le benchmark.');
        }
        if (state.status === 'success' || state.status === 'error') break;
        await delay(
          Math.min(config.pollMs, Math.max(1, deadline - Date.now())),
        );
        state = await api(compilationPath, bounded());
      }
      job.resultObservedAt = Date.now();
      job.compileMs = state.durationMs ?? null;
      job.compiledAt = state.compiledAt ?? null;
      if (state.status === 'error') {
        job.outcome = 'compilation_error';
        job.error = 'Le compilateur a retourné un état error.';
      } else {
        if (state.pdfJobId !== job.jobId)
          throw new Error('Le PDF ne correspond pas au job soumis.');
        job.outcome = 'pdf_error';
        job.pdfBytes = await api(
          `${compilationPath}/pdf`,
          bounded({ pdf: true }),
        );
        job.pdfAvailableAt = Date.now();
        job.endToEndMs = job.pdfAvailableAt - job.submittedAt;
        job.outcome = 'success';
      }
    } catch (error) {
      job.outcome =
        Date.now() >= deadline ? 'timeout' : (job.outcome ?? 'request_error');
      job.error = error.message;
      // A timed-out/ambiguous submission can still be executing. Never reuse
      // that project and accidentally supersede the outstanding compilation.
      project.retired = true;
    } finally {
      job.finishedAt = Date.now();
      project.busy = false;
      await appendFile(
        path.join(config.output, 'jobs.jsonl'),
        `${JSON.stringify(job)}\n`,
      );
    }
  }

  function offer(phase, scheduledAt) {
    const job = {
      index: report.jobs.length + 1,
      phase: phase.name,
      warmup: phase.warmup,
      scheduledAt,
      offeredAt: Date.now(),
    };
    report.jobs.push(job);
    const project = projects.find((entry) => !entry.busy && !entry.retired);
    if (attempts >= config.maxJobs || !project) {
      job.outcome =
        attempts >= config.maxJobs ? 'skipped_job_limit' : 'skipped_capacity';
      job.finishedAt = Date.now();
      return;
    }
    attempts++;
    job.projectId = project.id;
    job.scheduleLagMs = job.offeredAt - scheduledAt;
    project.busy = true;
    const task = runJob(project, job).catch((error) =>
      warn(`Écriture du journal jobs impossible : ${error.code ?? 'erreur'}.`),
    );
    running.add(task);
    void task.finally(() => running.delete(task));
  }

  const sleepUntil = async (at) => {
    while (!stopping && Date.now() < at)
      await delay(Math.min(200, at - Date.now()));
  };

  try {
    if (!token) {
      const session = await api('/auth/login', {
        method: 'POST',
        body: { email: config.email, password: config.password },
      });
      if (!session.token) throw new Error('Authentification sans token.');
      token = session.token;
    }
    await api('/auth/me');
    const initial = await sample();
    if (
      !initial.queue ||
      initial.queue.available === false ||
      !initial.autoscaler ||
      (config.docker && !initial.fleet)
    )
      throw new Error(
        'Précontrôle échoué : API de file, autoscaler ou Docker indisponible.',
      );
    report.initialWorkerCount = initial.fleet?.workerCount ?? null;
    if (initial.queue.waitingCount || initial.queue.activeCount)
      warn(
        'La file contient déjà des jobs : les métriques globales incluent cette charge externe.',
      );
    if (config.docker && !initial.fleet.workerCount)
      throw new Error('Aucun worker actif. Démarre la stack avant le test.');

    const offeredCount = config.plan.reduce(
      (sum, phase) => sum + arrivalOffsets(phase).length,
      0,
    );
    const poolSize = Math.min(config.maxInFlight, config.maxJobs, offeredCount);
    console.log(
      `Préparation de ${poolSize} projets isolés. Rapport : ${config.output}`,
    );
    for (let index = 0; index < poolSize && !stopping; index++) {
      const fileId = randomUUID();
      const { project } = await api('/projects', {
        method: 'POST',
        body: {
          name: `Benchmark compilation ${report.runId.slice(0, 8)} ${index + 1}`,
          files: [
            {
              id: fileId,
              name: 'main.tex',
              type: 'tex',
              content: config.source,
              createdAt: new Date().toISOString(),
            },
          ],
        },
      });
      projects.push({ id: project.id, fileId, busy: false, retired: false });
      // Persist IDs immediately so interrupted runs can be cleaned manually.
      await writeFile(
        path.join(config.output, 'projects.json'),
        JSON.stringify(
          projects.map((entry) => entry.id),
          null,
          2,
        ),
      );
    }
    sampling = true;
    sampler = (async () => {
      while (sampling) {
        const start = Date.now();
        await sample();
        const next = start + config.sampleMs;
        while (sampling && Date.now() < next)
          await delay(Math.min(200, next - Date.now()));
      }
    })().catch((error) => {
      warn(`Collecte interrompue : ${error.code ?? 'erreur'}.`);
    });

    report.loadStartedAt = Date.now();
    for (const definition of config.plan) {
      if (stopping) break;
      phaseName = definition.name;
      const phase = { ...definition, startedAt: Date.now() };
      report.phases.push(phase);
      console.log(
        `Phase ${phase.name} : ${phase.durationSeconds}s, ${phase.ratePerSecond}/s, burst=${phase.burst}`,
      );
      for (const offset of arrivalOffsets(phase)) {
        const dueAt = phase.startedAt + offset;
        await sleepUntil(dueAt);
        if (stopping) break;
        // Do not turn scheduler stalls into artificial bursts.
        if (Date.now() - dueAt > Math.max(1000, config.pollMs * 2)) {
          report.jobs.push({
            index: report.jobs.length + 1,
            phase: phase.name,
            warmup: phase.warmup,
            scheduledAt: dueAt,
            offeredAt: Date.now(),
            outcome: 'skipped_scheduler',
          });
        } else offer(phase, dueAt);
      }
      await sleepUntil(phase.startedAt + phase.durationSeconds * 1000);
      phase.endedAt = Date.now();
    }
    report.loadEndedAt = Date.now();
    phaseName = 'drain';
    console.log(`Drainage de ${running.size} compilation(s)…`);
    await Promise.allSettled([...running]);
    report.drainedAt = Date.now();
    phaseName = 'recovery';
    const recoveryDeadline = Date.now() + config.recoveryMs;
    let stable = 0;
    let inspectedAt = 0;
    while (!stopping && Date.now() < recoveryDeadline) {
      const latest = report.samples.at(-1);
      if (latest && latest.at !== inspectedAt && latest.phase === 'recovery') {
        inspectedAt = latest.at;
        const idle =
          latest.queue?.waitingCount === 0 && latest.queue?.activeCount === 0;
        const floor =
          config.docker &&
          latest.fleet &&
          latest.fleet.workerCount <= config.minWorkers;
        stable = idle && (!config.docker || floor) ? stable + 1 : 0;
        if (stable >= 2) {
          report.queueIdleAt = latest.at;
          if (config.docker) report.recoveredAt = latest.at;
          break;
        }
      }
      await delay(100);
    }
    report.recoveryReached = Boolean(report.recoveredAt);
    if (!report.recoveryReached)
      warn(
        'Retour au plancher non confirmé dans la fenêtre d’observation (ou comptage Docker désactivé).',
      );
  } catch (error) {
    report.fatalError = error.message;
    console.error(`Échec : ${error.message}`);
  } finally {
    stopping = true;
    await Promise.allSettled([...running]);
    sampling = false;
    await sampler;
    if (config.queueTimings && report.jobs.some((job) => job.jobId)) {
      try {
        await collectQueueTimings(config, report.jobs);
      } catch {
        warn(
          'Timings Redis indisponibles : attente individuelle laissée vide, sans estimation. Vérifie que le Docker Compose local correspond aux API testées.',
        );
      }
    }
    phaseName = 'cleanup';
    for (const project of projects) {
      try {
        await api(`/projects/${project.id}`, { method: 'DELETE' });
      } catch {
        report.cleanupFailures.push(project.id);
      }
    }
    if (report.cleanupFailures.length)
      warn(
        'Certains projets n’ont pas pu être supprimés ; leurs IDs sont dans le rapport.',
      );
    report.finishedAt = new Date().toISOString();
    if (report.samples.some((entry) => entry.collectionMs > config.sampleMs))
      warn(
        'Certaines collectes dépassent la période demandée ; utilise les timestamps réels pour analyser les courbes.',
      );
    exportResult = await writeReports(config.output, report, exportOptions());
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
  const failures = report.jobs.filter(
    (job) => !job.outcome.startsWith('skipped_') && job.outcome !== 'success',
  );
  const skipped = report.jobs.filter((job) =>
    job.outcome.startsWith('skipped_'),
  );
  printResults(config, exportResult);
  if (
    report.fatalError ||
    failures.length ||
    skipped.length ||
    report.cleanupFailures.length
  )
    process.exitCode = 1;
  if (report.interrupted) process.exitCode = 130;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
