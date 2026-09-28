// Live, visible demo of apps/compilation-autoscaler reacting to real load —
// driven through the REAL web editor UI with a REAL browser, not raw API
// calls. Run it yourself, watch the browser window, and watch this
// terminal: you will see real "frelated-compilation-worker-auto-*"
// containers appear in `docker ps` while the burst is being processed, and
// disappear again once it drains.
//
// Prerequisites:
//   1. The full stack running: `bash run-docker.sh up` (from the repo root).
//   2. The autoscaler running too: `docker compose up -d compilation-autoscaler`.
//
// Usage (from apps/web-editor-ui):
//   node e2e/autoscaler-live-demo.mjs
//
// Env vars (all optional, sensible defaults for the local Docker stack):
//   WEB_EDITOR_URL, PROJECTS_API_URL, AUTOSCALER_URL, DEMO_EMAIL,
//   DEMO_PASSWORD, DEMO_PROJECT_COUNT, DEMO_SLOWMO_MS, DEMO_HEADLESS
import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WEB_EDITOR_URL = process.env.WEB_EDITOR_URL || 'http://localhost:5173';
const API_URL = process.env.PROJECTS_API_URL || 'http://localhost:3000';
const AUTOSCALER_URL = process.env.AUTOSCALER_URL || 'http://localhost:3100';
const EMAIL = process.env.DEMO_EMAIL || 'regent@frelated.dev';
const PASSWORD = process.env.DEMO_PASSWORD || 'frelated123';
const PROJECT_COUNT = Number(process.env.DEMO_PROJECT_COUNT || 6);
const SLOWMO_MS = Number(process.env.DEMO_SLOWMO_MS || 150);
const HEADLESS = process.env.DEMO_HEADLESS === 'true';

const OUTPUT_DIR = path.join(__dirname, 'autoscaler-demo-output');
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, 'screenshots');
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const startedAt = Date.now();
const say = (...args) =>
  console.log(
    `\x1b[36m[${((Date.now() - startedAt) / 1000).toFixed(1)}s]\x1b[0m`,
    ...args,
  );
const fleetLine = (...args) =>
  console.log(`\x1b[33m  [flotte docker]\x1b[0m`, ...args);

/** A document that genuinely takes real wall-clock time to compile (real
 * pdflatex CPU cost), so the burst survives long enough in the queue for
 * the autoscaler's polling to actually see it. A trivial one-line document
 * is drained by a single worker in under a second — faster than the
 * autoscaler can ever observe. Uses `\node` (font metrics + box layout per
 * shape) rather than a plain `\fill circle` (a single filled path): once a
 * worker's font/format caches are warm — which they will be after this
 * demo has run a few times against the same long-lived container — a
 * simple fill-only grid drops from ~10s to ~1s and stops being observable.
 * Per-node text layout stays comparatively expensive regardless of warmth. */
function heavyTikzDocument(gridSize = 55) {
  const lines = [];
  for (let x = 0; x < gridSize; x++) {
    lines.push(
      `\\foreach \\y in {1,...,${gridSize}} { \\node[draw,circle,inner sep=0.4pt,font=\\tiny] at (${x}*0.2,\\y*0.2) {${x}}; }`,
    );
  }
  return `\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\n\\begin{tikzpicture}\n${lines.join('\n')}\n\\end{tikzpicture}\n\\end{document}\n`;
}

function realWorkerContainerNames() {
  try {
    const out = execSync(
      `docker ps --filter "name=frelated-compilation-worker" --format "{{.Names}}"`,
      { encoding: 'utf8' },
    );
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
  } catch {
    return ['(docker CLI unavailable from this script)'];
  }
}

async function autoscalerStatus() {
  try {
    const res = await fetch(`${AUTOSCALER_URL}/status`);
    return await res.json();
  } catch {
    return null;
  }
}

/** Prints the real container fleet + the autoscaler's own decision every few
 * seconds, so this terminal is the visible proof of what is happening on
 * the Docker host while the browser window shows what triggered it. */
function watchFleet(intervalMs = 2000) {
  let lastNames = '';
  const timer = setInterval(async () => {
    const names = realWorkerContainerNames();
    const status = await autoscalerStatus();
    const namesKey = names.join(',');
    const changed = namesKey !== lastNames;
    lastNames = namesKey;
    fleetLine(
      `${changed ? '\x1b[1m*** CHANGED *** ' : ''}${names.length} conteneur(s): ${names.join(', ')} — décision: ${status?.lastDecision?.type ?? '?'} (${status?.lastDecision?.reason ?? 'n/a'})`,
    );
  }, intervalMs);
  return () => clearInterval(timer);
}

async function main() {
  say(
    '=== Démo en direct : compilation-autoscaler piloté par de vrais clics ===',
  );
  say(
    `Éditeur : ${WEB_EDITOR_URL} | API : ${API_URL} | Autoscaler : ${AUTOSCALER_URL}`,
  );

  const initialFleet = realWorkerContainerNames();
  say('Flotte de workers réels au départ :', initialFleet.join(', '));
  if (initialFleet.length === 0 || initialFleet[0].startsWith('(')) {
    say(
      '\x1b[31mATTENTION\x1b[0m : aucun worker détecté. As-tu bien lancé `bash run-docker.sh up` ?',
    );
  }
  const status0 = await autoscalerStatus();
  if (!status0) {
    say(
      `\x1b[31mATTENTION\x1b[0m : impossible de joindre l'autoscaler sur ${AUTOSCALER_URL}/status. As-tu lancé \`docker compose up -d compilation-autoscaler\` ?`,
    );
  }

  say("Ouverture d'un vrai navigateur Chromium visible...");
  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: SLOWMO_MS,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: path.join(OUTPUT_DIR, 'video') },
  });

  const projectIds = [];
  let token;

  try {
    const loginPage = await context.newPage();
    say(`Connexion réelle via le formulaire de l'interface (${EMAIL})...`);
    await loginPage.goto(`${WEB_EDITOR_URL}/login`);
    await loginPage.getByPlaceholder('vous@exemple.com').fill(EMAIL);
    await loginPage.getByPlaceholder('••••••••').fill(PASSWORD);
    await loginPage.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-login.png'),
    });
    await loginPage.getByRole('button', { name: 'Se connecter' }).click();
    await loginPage.waitForURL(/\/(projects|editor)/, { timeout: 15000 });
    say('Connecté. Session récupérée depuis le navigateur réel.');
    token = await loginPage.evaluate(() => {
      const raw = localStorage.getItem('frelated-api-session');
      return raw ? JSON.parse(raw).token : null;
    });

    say(
      `Création de ${PROJECT_COUNT} projets réels, l'un après l'autre, via le bouton "Nouveau projet"...`,
    );
    for (let i = 0; i < PROJECT_COUNT; i++) {
      if (i > 0) await loginPage.goto(`${WEB_EDITOR_URL}/projects`);
      await loginPage
        .getByRole('button', { name: 'Nouveau projet', exact: true })
        .click();
      await loginPage
        .getByPlaceholder('ex : Thèse de doctorat 2025')
        .fill(`Démo autoscaler ${i + 1}`);
      const [response] = await Promise.all([
        loginPage.waitForResponse(
          (r) =>
            r.request().method() === 'POST' && r.url().endsWith('/projects'),
        ),
        loginPage.getByRole('button', { name: 'Créer et ouvrir' }).click(),
      ]);
      const { project } = await response.json();
      projectIds.push(project.id);
      say(`  projet ${i + 1}/${PROJECT_COUNT} créé : ${project.id}`);
    }
    await loginPage.screenshot({
      path: path.join(SCREENSHOT_DIR, '02-projects-created.png'),
    });

    say(
      `Ouverture d'un onglet réel par projet (${PROJECT_COUNT} onglets, même session)...`,
    );
    const pages = await Promise.all(projectIds.map(() => context.newPage()));
    await Promise.all(
      pages.map((page, i) =>
        page.goto(`${WEB_EDITOR_URL}/editor/${projectIds[i]}`),
      ),
    );
    await Promise.all(
      pages.map((page) =>
        page
          .locator('.cm-content')
          .waitFor({ state: 'visible', timeout: 20000 }),
      ),
    );

    say(
      'Démarrage de la surveillance en direct de la flotte Docker (regarde ce terminal)...',
    );
    const stopWatching = watchFleet();

    const heavySource = heavyTikzDocument(55);
    say(
      `Frappe du document LaTeX lourd et Ctrl+S dans les ${PROJECT_COUNT} onglets EN MÊME TEMPS — c'est ce Ctrl+S qui soumet chaque compilation, toutes à la fois, vraiment en rafale...`,
    );
    await Promise.all(
      pages.map(async (page) => {
        await page.locator('.cm-content').click();
        await page.locator('.cm-content').fill(heavySource);
        await page.waitForTimeout(300); // let CodeMirror settle before the save shortcut
        await page.locator('.cm-content').press('Control+s');
      }),
    );
    await pages[0].screenshot({
      path: path.join(SCREENSHOT_DIR, '03-compiling.png'),
    });

    say(
      'Rafale soumise. Observation du scale-up réel pendant le traitement...',
    );
    const headers = { Authorization: `Bearer ${token}` };
    const waitForSuccess = async (projectId) => {
      const start = Date.now();
      while (Date.now() - start < 180000) {
        const res = await fetch(
          `${API_URL}/projects/${projectId}/compilation`,
          { headers },
        );
        const state = await res.json();
        if (state.status === 'success' || state.status === 'error')
          return state;
        await new Promise((r) => setTimeout(r, 700));
      }
      throw new Error(`timeout waiting for project ${projectId}`);
    };
    const results = await Promise.allSettled(projectIds.map(waitForSuccess));
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        say(
          `  \x1b[31mprojet ${i + 1} n'a pas abouti :\x1b[0m ${result.reason}`,
        );
      }
    });
    say(
      'Compilations réelles terminées (ou signalées ci-dessus si un souci est survenu).',
    );

    await pages[0]
      .getByRole('button', { name: 'PDF', exact: true })
      .click()
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    await pages[0].screenshot({
      path: path.join(SCREENSHOT_DIR, '04-pdf-ready.png'),
    });

    say('Attente du scale-down réel (cooldown + file vide)...');
    await new Promise((r) => setTimeout(r, 45000));

    stopWatching();
    const finalFleet = realWorkerContainerNames();
    say('Flotte de workers réels à la fin :', finalFleet.join(', '));
    say(`Captures d'écran et vidéo enregistrées dans : ${OUTPUT_DIR}`);
  } finally {
    say(
      `Nettoyage : suppression des ${projectIds.length} projet(s) de démo créés...`,
    );
    if (token) {
      for (const id of projectIds) {
        await fetch(`${API_URL}/projects/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).catch((error) => say('  erreur de nettoyage', id, error.message));
      }
    }
    await context.close();
    await browser.close();
    say('=== Terminé ===');
  }
}

main().catch((error) => {
  console.error('ÉCHEC :', error);
  process.exitCode = 1;
});
