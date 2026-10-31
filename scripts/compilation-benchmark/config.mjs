import { readFile } from 'node:fs/promises';
import { parseArgs, parseEnv } from 'node:util';
import path from 'node:path';

export const defaultPlan = [
  { name: 'warmup', durationSeconds: 15, burst: 1, warmup: true },
  { name: 'baseline', durationSeconds: 30, ratePerSecond: 0.1 },
  { name: 'ramp', durationSeconds: 45, ratePerSecond: 0.25 },
  { name: 'burst', durationSeconds: 30, burst: 12 },
  { name: 'sustained', durationSeconds: 60, ratePerSecond: 0.5 },
  { name: 'decrease', durationSeconds: 30, ratePerSecond: 0.1 },
];

export function validatePlan(input) {
  if (!Array.isArray(input) || !input.length)
    throw new Error('Le plan doit être un tableau de phases non vide.');
  const names = new Set();
  return input.map((phase) => {
    if (
      !phase ||
      typeof phase.name !== 'string' ||
      !phase.name.trim() ||
      names.has(phase.name) ||
      !Number.isFinite(phase.durationSeconds) ||
      phase.durationSeconds <= 0 ||
      !Number.isFinite(phase.ratePerSecond ?? 0) ||
      (phase.ratePerSecond ?? 0) < 0 ||
      !Number.isSafeInteger(phase.burst ?? 0) ||
      (phase.burst ?? 0) < 0
    )
      throw new Error(
        'Phase invalide : nom unique, durée > 0, débit et burst >= 0 requis.',
      );
    names.add(phase.name);
    return {
      name: phase.name,
      durationSeconds: phase.durationSeconds,
      ratePerSecond: phase.ratePerSecond ?? 0,
      burst: phase.burst ?? 0,
      warmup: phase.warmup === true,
    };
  });
}

export function arrivalOffsets(phase) {
  const arrivals = Array(phase.burst).fill(0);
  if (phase.ratePerSecond > 0) {
    const count = Math.ceil(phase.durationSeconds * phase.ratePerSecond);
    for (let i = 0; i < count; i++)
      arrivals.push((i * 1000) / phase.ratePerSecond);
  }
  return arrivals.sort((a, b) => a - b);
}

const help = `Benchmark du flow réel de compilation (Node >= 22.11, aucune dépendance).

Depuis la racine : node scripts/compilation-benchmark.mjs [options]

  --start-stack                 Lance bash run-docker.sh up avant le benchmark
  --quick                       Plan court de 40 secondes, hors drainage/récupération
  --plan CHEMIN                 Tableau JSON de phases (voir docs/CompilationBenchmark.md)
  --document CHEMIN             Document .tex autonome ; sinon TikZ généré
  --grid-size N                 Taille de la grille TikZ (défaut 35)
  --max-in-flight N             Projets/compilations simultanés maximum (24)
  --max-jobs N                  Nombre maximum de tentatives de compilation (120)
  --sample-ms N                 Période de collecte (2000)
  --poll-ms N                   Période de lecture de l'état d'un job (500)
  --job-timeout-seconds N       Délai total maximum par job (300)
  --recovery-seconds N          Observation après drainage, jusqu'au plancher (180)
  --request-timeout-ms N        Timeout HTTP et commandes Docker (10000)
  --min-workers N              Plancher attendu (AUTOSCALER_MIN_WORKERS ou 1)
  --env-file CHEMIN             Fichier Compose à lire (.env.docker)
  --api-url URL                 API projets (http://localhost:3000)
  --queue-url URL               Métriques de file (http://localhost:3200)
  --autoscaler-url URL          Autoscaler (http://localhost:3100)
  --output CHEMIN              Répertoire du rapport (artifacts/compilation-benchmark/...)
  --report-only CHEMIN         Régénère HTML/PDF/CSV depuis un report.json, sans charge
  --pdf-browser CHEMIN         Exécutable Chrome/Chromium (détection automatique)
  --pdf-timeout-seconds N      Délai maximum de génération PDF (60)
  --pdf-no-sandbox             Pour un environnement isolé sans sandbox Chromium
  --no-pdf                     Désactive explicitement l'export PDF
  --no-docker                  Sans flotte, statistiques Docker ni timings BullMQ
  --no-queue-timings           Désactive uniquement la lecture des timestamps Redis
  --help                       Affiche cette aide

Identifiants : BENCHMARK_TOKEN ou BENCHMARK_EMAIL / BENCHMARK_PASSWORD
(défauts du compte démo : regent@frelated.dev / frelated123).
Jeton métriques : BENCHMARK_AUTOSCALER_TOKEN, sinon COMPILATION_AUTOSCALER_TOKEN
de l'environnement ou du fichier Compose. Les secrets ne sont pas exportés.
La stack reste démarrée ; seuls les projets créés par ce benchmark sont supprimés.
Le rapport PDF est généré automatiquement avec Chrome/Chromium installé.
`;

export async function readConfig(root, args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: Object.fromEntries([
      ...[
        'start-stack',
        'quick',
        'no-docker',
        'no-queue-timings',
        'no-pdf',
        'pdf-no-sandbox',
        'help',
      ].map((name) => [name, { type: 'boolean' }]),
      ...[
        'plan',
        'document',
        'grid-size',
        'max-in-flight',
        'max-jobs',
        'sample-ms',
        'poll-ms',
        'job-timeout-seconds',
        'recovery-seconds',
        'request-timeout-ms',
        'min-workers',
        'env-file',
        'api-url',
        'queue-url',
        'autoscaler-url',
        'output',
        'report-only',
        'pdf-browser',
        'pdf-timeout-seconds',
      ].map((name) => [name, { type: 'string' }]),
    ]),
  });
  if (values.help) {
    console.log(help);
    return null;
  }
  const envFile = path.resolve(root, values['env-file'] ?? '.env.docker');
  let fileEnv = {};
  try {
    fileEnv = parseEnv(await readFile(envFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' || values['env-file']) throw error;
  }
  const env = { ...fileEnv, ...process.env };
  const number = (key, fallback, { zero = false, integer = true } = {}) => {
    const value = Number(values[key] ?? fallback);
    if (
      !Number.isFinite(value) ||
      value < (zero ? 0 : Number.MIN_VALUE) ||
      (integer && !Number.isSafeInteger(value))
    )
      throw new Error(
        `--${key} : nombre ${zero ? '>= 0' : '> 0'} ${integer ? 'entier' : ''} requis.`,
      );
    return value;
  };
  const url = (key, port) => {
    const parsed = new URL(values[key] ?? `http://localhost:${port}`);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error(
        `--${key} : URL HTTP(S) sans identifiants, query ni fragment requise.`,
      );
    return parsed.toString().replace(/\/$/u, '');
  };
  const quickPlan = [
    { name: 'warmup', durationSeconds: 5, burst: 1, warmup: true },
    { name: 'baseline', durationSeconds: 10, ratePerSecond: 0.2 },
    { name: 'burst', durationSeconds: 15, burst: 8 },
    { name: 'decrease', durationSeconds: 10, ratePerSecond: 0.1 },
  ];
  const plan = validatePlan(
    values.plan
      ? JSON.parse(await readFile(path.resolve(root, values.plan), 'utf8'))
      : values.quick
        ? quickPlan
        : defaultPlan,
  );
  const maxJobs = number('max-jobs', 120);
  // Check cardinality before allocating the schedule.
  const offeredJobs = plan.reduce(
    (total, phase) =>
      total +
      phase.burst +
      Math.ceil(phase.durationSeconds * phase.ratePerSecond),
    0,
  );
  if (!Number.isSafeInteger(offeredJobs) || offeredJobs > 100_000)
    throw new Error('Plan trop grand : maximum 100 000 arrivées.');
  const config = {
    root,
    envFile,
    plan,
    startStack: values['start-stack'] === true,
    reportOnly: values['report-only']
      ? path.resolve(root, values['report-only'])
      : null,
    pdf: !values['no-pdf'],
    pdfBrowser: values['pdf-browser'] || env.BENCHMARK_PDF_BROWSER,
    pdfTimeoutMs: number('pdf-timeout-seconds', 60, { integer: false }) * 1000,
    pdfNoSandbox: values['pdf-no-sandbox'] === true,
    docker: !values['no-docker'],
    queueTimings: !values['no-docker'] && !values['no-queue-timings'],
    apiUrl: url('api-url', env.PROJECTS_API_PORT || 3000),
    queueUrl: url('queue-url', env.COMPILATION_QUEUE_SERVICE_PORT || 3200),
    autoscalerUrl: url(
      'autoscaler-url',
      env.COMPILATION_AUTOSCALER_PORT || 3100,
    ),
    queueName: env.COMPILATION_QUEUE_NAME || 'frelated-latex',
    email: env.BENCHMARK_EMAIL || 'regent@frelated.dev',
    password: env.BENCHMARK_PASSWORD || 'frelated123',
    token: env.BENCHMARK_TOKEN,
    autoscalerToken:
      env.BENCHMARK_AUTOSCALER_TOKEN ||
      env.COMPILATION_AUTOSCALER_TOKEN ||
      'frelated-dev-autoscaler-token-change-me',
    maxJobs,
    maxInFlight: number('max-in-flight', 24),
    sampleMs: number('sample-ms', 2000),
    pollMs: number('poll-ms', 500),
    jobTimeoutMs: number('job-timeout-seconds', 300, { integer: false }) * 1000,
    recoveryMs:
      number('recovery-seconds', 180, { zero: true, integer: false }) * 1000,
    requestTimeoutMs: number('request-timeout-ms', 10000),
    minWorkers: number('min-workers', env.AUTOSCALER_MIN_WORKERS || 1, {
      zero: true,
    }),
    gridSize: number('grid-size', 35),
    output: path.resolve(
      root,
      values.output ??
        (values['report-only']
          ? path.dirname(path.resolve(root, values['report-only']))
          : `artifacts/compilation-benchmark/${new Date().toISOString().replace(/[:.]/gu, '-')}`),
    ),
  };
  if (config.maxInFlight > 256 || config.gridSize > 100)
    throw new Error(
      'Maximum 256 projets simultanés et une grille TikZ de 100.',
    );
  config.source = values.document
    ? await readFile(path.resolve(root, values.document), 'utf8')
    : tikzDocument(config.gridSize);
  return config;
}

export function tikzDocument(size) {
  const rows = Array.from(
    { length: size },
    (_, x) =>
      String.raw`\foreach \y in {1,...,${size}} { \node[draw,circle,inner sep=0.4pt,font=\tiny] at (${x}*0.15,\y*0.15) {${x}}; }`,
  );
  return String.raw`\documentclass{article}
\usepackage{tikz}
\begin{document}
\begin{tikzpicture}
${rows.join('\n')}
\end{tikzpicture}
\end{document}
`;
}
