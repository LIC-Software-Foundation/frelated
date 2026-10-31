import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generatePdf } from './pdf.mjs';

export function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
    : null;
}

export function statistics(jobs) {
  const successes = jobs.filter((job) => job.outcome === 'success');
  const attempted = jobs.filter((job) => !job.outcome.startsWith('skipped_'));
  const accepted = jobs.filter((job) => job.jobId);
  const failed = attempted.filter((job) => job.outcome !== 'success');
  const failureCounts = Object.fromEntries(
    [
      'compilation_error',
      'request_error',
      'timeout',
      'superseded',
      'pdf_error',
    ].map((outcome) => [
      outcome,
      failed.filter((job) => job.outcome === outcome).length,
    ]),
  );
  const metric = (key) => ({
    count: successes.filter((job) => Number.isFinite(job[key])).length,
    p50: percentile(
      successes.map((job) => job[key]),
      0.5,
    ),
    p95: percentile(
      successes.map((job) => job[key]),
      0.95,
    ),
    max: percentile(
      successes.map((job) => job[key]),
      1,
    ),
  });
  return {
    offered: jobs.length,
    attempted: attempted.length,
    submitted: jobs.filter((job) => Number.isFinite(job.submittedAt)).length,
    accepted: accepted.length,
    success: successes.length,
    failed: attempted.length - successes.length,
    skipped: jobs.length - attempted.length,
    errorRate: attempted.length
      ? (attempted.length - successes.length) / attempted.length
      : null,
    successRate: attempted.length ? successes.length / attempted.length : null,
    acceptedFailed: accepted.filter((job) => job.outcome !== 'success').length,
    notAcceptedFailed: failed.filter((job) => !job.jobId).length,
    failureCounts,
    compileMs: metric('compileMs'),
    queueWaitMs: metric('queueWaitMs'),
    workerProcessingMs: metric('workerProcessingMs'),
    endToEndMs: metric('endToEndMs'),
    scheduleLagMs: {
      p95: percentile(
        attempted.map((job) => job.scheduleLagMs),
        0.95,
      ),
    },
  };
}

export function buildSummary(report) {
  const jobs = report.jobs.filter((job) => !job.warmup);
  const start = report.phases.find((phase) => !phase.warmup)?.startedAt;
  const completed = jobs.filter((job) => job.outcome === 'success');
  const end = start
    ? Math.max(
        report.loadEndedAt ?? start,
        ...jobs.map((job) => job.finishedAt ?? start),
      )
    : null;
  const windowSeconds = start && end > start ? (end - start) / 1000 : null;
  const workerCounts = report.samples
    .map((sample) => sample.fleet?.workerCount)
    .filter(Number.isFinite);
  const firstGrowth = report.samples.find(
    (sample) =>
      sample.at >= report.loadStartedAt &&
      sample.fleet?.workerCount > report.initialWorkerCount,
  );
  return {
    ...statistics(jobs),
    total: statistics(report.jobs),
    warmup: statistics(report.jobs.filter((job) => job.warmup)),
    windowSeconds,
    successPerMinute: windowSeconds
      ? (completed.length * 60) / windowSeconds
      : null,
    maxWaiting: percentile(
      report.samples.map((sample) => sample.queue?.waitingCount),
      1,
    ),
    maxWorkers: percentile(workerCounts, 1),
    firstWorkerGrowthMs: firstGrowth
      ? firstGrowth.at - report.loadStartedAt
      : null,
    drainMs:
      report.drainedAt && report.loadEndedAt
        ? report.drainedAt - report.loadEndedAt
        : null,
    recoveryAfterLoadMs:
      report.recoveredAt && report.loadEndedAt
        ? report.recoveredAt - report.loadEndedAt
        : null,
    phases: report.phases.map((phase) => {
      const phaseJobs = report.jobs.filter((job) => job.phase === phase.name);
      const completedDuringPhase = report.jobs.filter(
        (job) =>
          job.outcome === 'success' &&
          job.pdfAvailableAt >= phase.startedAt &&
          job.pdfAvailableAt < phase.endedAt,
      ).length;
      return {
        name: phase.name,
        warmup: phase.warmup,
        ...statistics(phaseJobs),
        observedSuccessPerMinute:
          phase.endedAt > phase.startedAt
            ? (completedDuringPhase * 60_000) /
              (phase.endedAt - phase.startedAt)
            : null,
      };
    }),
  };
}

export function csv(rows, columns) {
  const cell = (value) => {
    if (value === null || value === undefined) return '';
    // Guard spreadsheet formula injection when reports include custom names.
    const text =
      typeof value === 'string' && /^[=+@\-\t\r]/u.test(value)
        ? `'${value}`
        : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };
  return `${columns.join(',')}\n${rows.map((row) => columns.map((key) => cell(row[key])).join(',')).join('\n')}\n`;
}

const escape = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const format = (value, decimals = 0) =>
  Number.isFinite(value) ? value.toFixed(decimals) : '—';
const seconds = (milliseconds) =>
  Number.isFinite(milliseconds) ? format(milliseconds / 1000, 1) : '—';
const percent = (fraction) =>
  Number.isFinite(fraction) ? `${format(fraction * 100, 2)} %` : '—';

function workerTotal(sample, key) {
  if (!sample.fleet) return null;
  const values = sample.fleet.containers
    .filter((container) => container.worker)
    .map((container) => container[key]);
  return values.every(Number.isFinite)
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
}

function chart(title, samples, series, start, end) {
  const width = 960,
    height = 230,
    left = 64,
    right = 20,
    top = 16,
    bottom = 38;
  const plotWidth = width - left - right,
    plotHeight = height - top - bottom;
  const max = Math.max(
    1,
    ...samples
      .flatMap((sample) => series.map((entry) => entry.value(sample)))
      .filter(Number.isFinite),
  );
  const x = (at) =>
    left + ((at - start) / Math.max(1, end - start)) * plotWidth;
  const y = (value) => height - bottom - (value / max) * plotHeight;
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = (max * index) / 4;
    return `<line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" stroke="#e2e8f0"/><text x="${left - 8}" y="${y(value) + 4}" text-anchor="end">${format(value, max < 5 ? 1 : 0)}</text><text x="${left + (plotWidth * index) / 4}" y="${height - 12}" text-anchor="middle">${format(((end - start) * index) / 4000)} s</text>`;
  }).join('');
  const paths = series
    .map((entry) => {
      let penDown = false;
      const commands = samples
        .map((sample) => {
          const value = entry.value(sample);
          if (!Number.isFinite(value)) {
            penDown = false;
            return '';
          }
          const command = `${penDown ? 'L' : 'M'}${x(sample.at).toFixed(1)},${y(value).toFixed(1)}`;
          penDown = true;
          return command;
        })
        .join(' ');
      return `<path d="${commands}" stroke="${entry.color}" fill="none" stroke-width="2"/>`;
    })
    .join('');
  const legend = series
    .map(
      (entry) =>
        `<span><i style="background:${entry.color}"></i>${escape(entry.name)}</span>`,
    )
    .join('');
  return `<section><h2>${escape(title)}</h2><div class="legend">${legend}</div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(title)}">${grid}${paths}</svg></section>`;
}

function html(report, summary, { pdf = true } = {}) {
  const start = report.loadStartedAt ?? report.samples[0]?.at ?? Date.now();
  const samples = report.samples.filter((sample) => sample.at >= start);
  const end = samples.at(-1)?.at ?? start + 1;
  const jobs = report.jobs.filter(
    (job) => !job.warmup && job.outcome === 'success',
  );
  const latencySamples = jobs
    .map((job) => ({ at: job.pdfAvailableAt, ...job }))
    .sort((a, b) => a.at - b.at);
  const charts = [
    chart(
      'File et flotte',
      samples,
      [
        {
          name: 'En attente',
          color: '#d97706',
          value: (sample) => sample.queue?.waitingCount,
        },
        {
          name: 'En cours',
          color: '#2563eb',
          value: (sample) => sample.queue?.activeCount,
        },
        {
          name: 'Workers',
          color: '#059669',
          value: (sample) => sample.fleet?.workerCount,
        },
      ],
      start,
      end,
    ),
    chart(
      'Temps par compilation réussie (ms)',
      latencySamples,
      [
        {
          name: 'Jusqu’au PDF téléchargé',
          color: '#2563eb',
          value: (sample) => sample.endToEndMs,
        },
        {
          name: 'Compilation',
          color: '#059669',
          value: (sample) => sample.compileMs,
        },
        {
          name: 'Attente BullMQ',
          color: '#d97706',
          value: (sample) => sample.queueWaitMs,
        },
      ],
      start,
      Math.max(end, ...latencySamples.map((sample) => sample.at)),
    ),
    chart(
      'CPU cumulé des workers (%)',
      samples,
      [
        {
          name: '100 % ≈ un cœur utilisé',
          color: '#7c3aed',
          value: (sample) => workerTotal(sample, 'cpuPercent'),
        },
      ],
      start,
      end,
    ),
    chart(
      'Mémoire des workers (MiB)',
      samples,
      [
        {
          name: 'Mémoire cumulée',
          color: '#2563eb',
          value: (sample) => {
            const bytes = workerTotal(sample, 'memoryBytes');
            return bytes === null ? null : bytes / 1024 ** 2;
          },
        },
      ],
      start,
      end,
    ),
  ].join('');
  const phaseRows = summary.phases
    .map(
      (phase) =>
        `<tr><td>${escape(phase.name)}${phase.warmup ? ' (échauffement)' : ''}</td><td>${phase.offered}</td><td>${phase.attempted}</td><td>${phase.accepted}</td><td>${phase.success}</td><td>${phase.failed}</td><td>${percent(phase.errorRate)}</td><td>${phase.skipped}</td><td>${format(phase.compileMs.p95)}</td><td>${format(phase.queueWaitMs.p95)}</td><td>${format(phase.endToEndMs.p95)}</td><td>${format(phase.observedSuccessPerMinute, 1)}</td></tr>`,
    )
    .join('');
  const phaseTimes = report.phases
    .map(
      (phase) =>
        `<tr><td>${escape(phase.name)}</td><td>${format((phase.startedAt - start) / 1000, 1)} s</td><td>${format((phase.endedAt - start) / 1000, 1)} s</td><td>${phase.ratePerSecond}/s + rafale ${phase.burst}</td></tr>`,
    )
    .join('');
  const errors = report.jobs
    .filter((job) => job.error)
    .map(
      (job) =>
        `<li>Job ${job.index}, ${escape(job.phase)} : ${escape(job.outcome)} — ${escape(job.error)}</li>`,
    )
    .join('');
  const decisions = report.samples
    .filter(
      (sample, index) =>
        sample.autoscaler?.lastScalingActionAt &&
        sample.autoscaler.lastScalingActionAt !==
          report.samples[index - 1]?.autoscaler?.lastScalingActionAt,
    )
    .map(
      (sample) =>
        `<li>+${format((sample.at - start) / 1000, 1)} s : ${escape(sample.autoscaler.lastDecision?.type)} — ${escape(sample.autoscaler.lastDecision?.reason)}</li>`,
    )
    .join('');
  const card = (title, value) =>
    `<div class="card"><small>${title}</small><strong>${value}</strong></div>`;
  const populations = [
    ['Exécution complète', summary.total],
    ['Échauffement', summary.warmup],
    ['Mesure hors échauffement', summary],
  ];
  const countRows = populations
    .map(
      ([label, stats]) =>
        `<tr><td>${label}</td><td>${stats.offered}</td><td>${stats.attempted}</td><td>${stats.submitted}</td><td>${stats.accepted}</td><td>${stats.success}</td><td>${stats.failed}</td><td>${stats.skipped}</td><td>${percent(stats.errorRate)}</td><td>${percent(stats.successRate)}</td></tr>`,
    )
    .join('');
  const failureLabels = {
    compilation_error: 'Erreur de compilation',
    request_error: 'Erreur de requête ou de protocole',
    timeout: 'Timeout',
    superseded: 'Révision remplacée',
    pdf_error: 'Erreur de téléchargement ou de validation du PDF',
  };
  const failureRows = Object.entries(failureLabels)
    .map(
      ([outcome, label]) =>
        `<tr><td>${label}</td><td>${summary.total.failureCounts[outcome]}</td><td>${summary.failureCounts[outcome]}</td></tr>`,
    )
    .join('');
  const pdfLink =
    pdf && report.exports?.pdf?.status !== 'failed'
      ? '<a href="report.pdf">rapport PDF</a> · '
      : '';
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Benchmark compilation</title>
<style>body{font:15px system-ui,sans-serif;background:#f1f5f9;color:#0f172a;max-width:1200px;margin:32px auto;padding:0 20px}h1{font-size:30px}h2{font-size:19px}p,li{line-height:1.6}section,.card{background:white;padding:20px;border-radius:12px;margin:18px 0;box-shadow:0 1px 3px #0f172a15}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}.card{margin:0}.card small,.card strong{display:block}.card strong{font-size:26px;margin-top:8px}svg{width:100%;font:12px system-ui;fill:#64748b}.legend{display:flex;gap:20px;flex-wrap:wrap}.legend i{display:inline-block;width:12px;height:12px;margin-right:6px;border-radius:3px}table{border-collapse:collapse;width:100%;white-space:nowrap;font-size:13px}th,td{padding:10px;text-align:right;border-bottom:1px solid #e2e8f0}th:first-child,td:first-child{text-align:left}.scroll{overflow-x:auto}.warning{border-left:4px solid #d97706;padding-left:12px}a{color:#2563eb}</style>
<style>@page{size:A4 landscape;margin:12mm}@media print{body{max-width:none;margin:0;padding:0;background:white;font-size:10pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}h1{font-size:22pt}h2{font-size:13pt;break-after:avoid}section,.card{box-shadow:none;border:1px solid #cbd5e1;padding:12px;break-inside:avoid}section.flow{break-inside:auto}.cards{grid-template-columns:repeat(4,minmax(0,1fr))}.card strong{font-size:21px}svg{max-height:180px}.scroll{overflow:visible}table{white-space:normal;font-size:8pt}th,td{padding:5px}tr{break-inside:avoid}.screen-only{display:none}}</style>
<h1>Performance du flow de compilation</h1><p>Exécution ${escape(report.runId)} · ${escape(report.startedAt)} · ${report.fatalError ? `Échec : ${escape(report.fatalError)}` : report.interrupted ? 'Interrompue' : 'Terminée'}</p>
<p>Les compteurs de bilan incluent l’échauffement. Les latences et le débit de performance l’excluent.</p>
<div class="cards">${card('Compilations lancées (jobs acceptés)', summary.total.accepted)}${card('Réussies (PDF vérifié)', summary.total.success)}${card('Échouées (parcours complet)', summary.total.failed)}${card('Taux d’erreurs (échecs / tentatives)', percent(summary.total.errorRate))}${card('Tentatives de compilation', summary.total.attempted)}${card('Demandes non soumises', summary.total.skipped)}${card('PDF p95, hors échauffement', `${format(summary.endToEndMs.p95)} ms`)}${card('Attente en file p95, hors échauffement', `${format(summary.queueWaitMs.p95)} ms`)}${card('Débit hors échauffement, drainage inclus', `${format(summary.successPerMinute, 1)}/min`)}${card('Workers maximum observés', format(summary.maxWorkers))}${card('Jobs en attente maximum observés', format(summary.maxWaiting))}${card('Retour au plancher après arrêt de charge', report.recoveryReached ? `${format(summary.recoveryAfterLoadMs / 1000, 1)} s` : 'Non confirmé')}</div>
${report.warnings.map((warning) => `<p class="warning">${escape(warning)}</p>`).join('')}
${report.exports?.pdf?.status === 'failed' ? `<p class="warning">${escape(report.exports.pdf.error)}</p>` : ''}
<section><h2>Bilan des compilations</h2><div class="scroll"><table><thead><tr><th>Périmètre</th><th>Demandes offertes</th><th>Tentatives</th><th>POST envoyés</th><th>Compilations lancées (acceptées)</th><th>Réussies</th><th>Échouées</th><th>Non soumises</th><th>Taux d’erreurs</th><th>Taux de réussite</th></tr></thead><tbody>${countRows}</tbody></table></div><p>Taux d’erreurs = échecs du parcours / tentatives × 100. Une tentative inclut la sauvegarde du source, la soumission, l’attente et la vérification du PDF. Les demandes non soumises sont exclues de ce taux. Un échec avant confirmation de création du job compte comme échec de tentative : ${summary.total.notAcceptedFailed} ; échecs après acceptation : ${summary.total.acceptedFailed}. Un timeout indique un résultat non confirmé dans le délai, sans prouver l’arrêt du worker.</p></section>
<section><h2>Répartition des échecs</h2><div class="scroll"><table><thead><tr><th>Type</th><th>Total</th><th>Hors échauffement</th></tr></thead><tbody>${failureRows}</tbody></table></div></section>
${charts}
<section><h2>Résultats par cohorte de soumission</h2><div class="scroll"><table><thead><tr><th>Phase</th><th>Offerts</th><th>Tentatives</th><th>Lancées</th><th>Succès</th><th>Échecs</th><th>Taux d’erreurs</th><th>Non soumis</th><th>Compile p95 ms</th><th>File p95 ms</th><th>PDF p95 ms</th><th>Succès/min observés</th></tr></thead><tbody>${phaseRows}</tbody></table></div><p>Les latences regroupent les jobs soumis dans chaque phase, même s’ils finissent plus tard. Le débit de phase compte tous les PDF téléchargés pendant cette fenêtre, quelle que soit leur phase de soumission. Percentiles calculés sur les succès uniquement.</p></section>
<section><h2>Chronologie des phases</h2><div class="scroll"><table><thead><tr><th>Phase</th><th>Début</th><th>Fin</th><th>Charge offerte</th></tr></thead><tbody>${phaseTimes}</tbody></table></div><p>Drainage : ${seconds(summary.drainMs)} s. Première hausse observée de la flotte : ${summary.firstWorkerGrowthMs === null ? 'aucune' : `${seconds(summary.firstWorkerGrowthMs)} s après le début de la charge`}.</p></section>
<section><h2>Décisions de scaling observées</h2><ul>${decisions || '<li>Aucune action observée.</li>'}</ul><p>Une décision ne prouve pas la création effective d’un worker : consulter la courbe de flotte et les erreurs autoscaler dans les exports.</p></section>
<section class="flow"><h2>Erreurs</h2><ul>${errors || '<li>Aucune erreur de compilation ou de requête.</li>'}</ul><p>Projets restant à supprimer : ${escape(report.cleanupFailures.join(', ') || 'aucun')}.</p></section>
<section class="flow"><h2>Lecture des mesures</h2><ul><li>Temps PDF : soumission HTTP → téléchargement d’un PDF vérifié, avec une incertitude liée au polling (${escape(report.config.pollMs)} ms). La sauvegarde du source est horodatée séparément.</li><li>Attente BullMQ : processedOn − timestamp ; traitement worker : finishedOn − processedOn. Mesure d’attente disponible pour ${summary.queueWaitMs.count} compilations réussies sur ${summary.success}, hors échauffement. Ce compteur indique la couverture des mesures, et non le taux de réussite. Les jobs purgés par BullMQ restent sans timings.</li><li>Les arrivées ne ralentissent pas lorsque les workers saturent. Au-delà du plafond du générateur, elles sont comptées « non soumises ». Ce plafond empêche de conclure sur une charge que le script n’a pas réellement injectée.</li><li>Les métriques de file et de flotte sont globales. La charge et la mémoire hôte dans les exports concernent la machine exécutant le script ; Docker peut utiliser un autre hôte.</li><li>Les jobs ne se remplacent pas : chaque projet est réservé jusqu’au résultat et les soumissions ambiguës retirent le projet du pool. L’échauffement figure dans le bilan et est exclu des agrégats de performance.</li></ul><p class="screen-only">Exports : ${pdfLink}<a href="report.json">rapport JSON</a> · <a href="summary.csv">bilan CSV</a> · <a href="jobs.csv">jobs CSV</a> · <a href="samples.csv">échantillons CSV</a> · <a href="samples.jsonl">journal des métriques</a>.</p></section></html>`;
}

export async function writeReports(output, report, options = {}) {
  const summary = buildSummary(report);
  report.exports = {
    ...report.exports,
    pdf: { status: options.pdf === false ? 'disabled' : 'pending' },
  };
  const rows = report.samples.map((sample) => ({
    at: sample.at,
    phase: sample.phase,
    collectionMs: sample.collectionMs,
    waitingCount: sample.queue?.waitingCount,
    activeCount: sample.queue?.activeCount,
    delayedCount: sample.queue?.delayedCount,
    heavyWaitingCount: sample.queue?.heavyWaitingCount,
    oldestWaitingJobAgeMs: sample.queue?.oldestWaitingJobAgeMs,
    workerCount: sample.fleet?.workerCount,
    localInFlight: sample.localInFlight,
    workerCpuPercent: workerTotal(sample, 'cpuPercent'),
    workerMemoryBytes: workerTotal(sample, 'memoryBytes'),
    hostNormalizedLoad1m: sample.host?.normalizedLoad1m,
    hostAvailableMemoryBytes: sample.host?.availableMemoryBytes,
    decision: sample.autoscaler?.lastDecision?.type,
    reason: sample.autoscaler?.lastDecision?.reason,
    autoscalerError: sample.autoscaler?.lastError,
    collectionErrors: sample.errors.join('|'),
  }));
  const jobColumns = [
    'index',
    'phase',
    'warmup',
    'projectId',
    'jobId',
    'outcome',
    'scheduledAt',
    'offeredAt',
    'scheduleLagMs',
    'preparationStartedAt',
    'submittedAt',
    'acceptedAt',
    'resultObservedAt',
    'pdfAvailableAt',
    'finishedAt',
    'compiledAt',
    'compileMs',
    'queueWaitMs',
    'workerProcessingMs',
    'endToEndMs',
    'pdfBytes',
    'error',
  ];
  await Promise.all([
    writeFile(
      path.join(output, 'report.json'),
      `${JSON.stringify({ ...report, summary }, null, 2)}\n`,
    ),
    writeFile(path.join(output, 'report.html'), html(report, summary, options)),
    writeFile(
      path.join(output, 'summary.csv'),
      csv(
        [
          { scope: 'total', ...summary.total },
          { scope: 'warmup', ...summary.warmup },
          { scope: 'measured', ...summary },
          ...summary.phases.map((phase) => ({
            scope: `phase:${phase.name}`,
            ...phase,
          })),
        ].map((stats) => ({
          scope: stats.scope,
          offered: stats.offered,
          attempted: stats.attempted,
          submitted: stats.submitted,
          accepted: stats.accepted,
          success: stats.success,
          failed: stats.failed,
          skipped: stats.skipped,
          errorRatePercent: Number.isFinite(stats.errorRate)
            ? stats.errorRate * 100
            : null,
          successRatePercent: Number.isFinite(stats.successRate)
            ? stats.successRate * 100
            : null,
          ...stats.failureCounts,
        })),
        [
          'scope',
          'offered',
          'attempted',
          'submitted',
          'accepted',
          'success',
          'failed',
          'skipped',
          'errorRatePercent',
          'successRatePercent',
          'compilation_error',
          'request_error',
          'timeout',
          'superseded',
          'pdf_error',
        ],
      ),
    ),
    writeFile(path.join(output, 'jobs.csv'), csv(report.jobs, jobColumns)),
    writeFile(
      path.join(output, 'samples.csv'),
      csv(rows, Object.keys(rows[0] ?? { at: 0, phase: '' })),
    ),
    // Final journal also includes skipped arrivals and enrichment from Redis.
    writeFile(
      path.join(output, 'jobs.jsonl'),
      report.jobs.map((job) => JSON.stringify(job)).join('\n') + '\n',
    ),
  ]);
  if (options.pdf !== false) {
    try {
      report.exports.pdf = await generatePdf(output, {
        browserPath: options.browserPath,
        timeoutMs: options.timeoutMs,
        noSandbox: options.noSandbox,
      });
    } catch (error) {
      report.exports.pdf = { status: 'failed', error: error.message };
      await writeFile(
        path.join(output, 'report.html'),
        html(report, summary, options),
      );
    }
  }
  await writeFile(
    path.join(output, 'report.json'),
    `${JSON.stringify({ ...report, summary }, null, 2)}\n`,
  );
  return { summary, pdf: report.exports.pdf };
}
