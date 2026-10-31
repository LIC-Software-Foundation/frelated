import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, copyFile, mkdtemp, open, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);

async function findBrowser(browserPath) {
  const candidates = browserPath
    ? [browserPath]
    : [
        'google-chrome',
        'google-chrome-stable',
        'chromium',
        'chromium-browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        ...[
          process.env.PROGRAMFILES,
          process.env['PROGRAMFILES(X86)'],
          process.env.LOCALAPPDATA,
        ]
          .filter(Boolean)
          .map((base) =>
            path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          ),
      ];
  for (const candidate of candidates) {
    const locations =
      path.isAbsolute(candidate) || candidate.includes(path.sep)
        ? [path.resolve(candidate)]
        : (process.env.PATH ?? '')
            .split(path.delimiter)
            .filter(Boolean)
            .map((base) => path.join(base, candidate));
    for (const location of locations) {
      try {
        await access(location, constants.X_OK);
        return location;
      } catch {
        // Try the next installed Chrome/Chromium executable.
      }
    }
  }
  throw new Error(
    'Chrome/Chromium introuvable. Installe le navigateur ou indique son exécutable avec --pdf-browser.',
  );
}

export async function generatePdf(
  output,
  { browserPath, timeoutMs = 60_000, noSandbox = false } = {},
) {
  const browser = await findBrowser(browserPath);
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), 'compilation-report-pdf-'),
  );
  const temporaryPdf = path.join(temporary, 'report.pdf');
  try {
    await exec(
      browser,
      [
        '--headless',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-background-networking',
        '--disable-extensions',
        '--disable-sync',
        '--no-first-run',
        '--no-default-browser-check',
        '--no-pdf-header-footer',
        `--user-data-dir=${path.join(temporary, 'profile')}`,
        `--print-to-pdf=${temporaryPdf}`,
        ...(noSandbox ? ['--no-sandbox'] : []),
        pathToFileURL(path.join(path.resolve(output), 'report.html')).href,
      ],
      { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
    );
    // Chromium can exit successfully without printing (profile/sandbox errors).
    const handle = await open(temporaryPdf, 'r');
    try {
      const signature = Buffer.alloc(5);
      await handle.read(signature, 0, 5, 0);
      if (signature.toString() !== '%PDF-')
        throw new Error('Fichier PDF invalide.');
    } finally {
      await handle.close();
    }
    // Copying works even if /tmp and the output directory are on different volumes.
    const destination = path.join(output, 'report.pdf');
    const staged = path.join(output, `.report-${path.basename(temporary)}.pdf`);
    try {
      await copyFile(temporaryPdf, staged);
      await rename(staged, destination);
    } finally {
      await rm(staged, { force: true });
    }
    return { status: 'generated', file: 'report.pdf' };
  } catch (error) {
    const detail = error.killed
      ? 'délai de génération dépassé'
      : /sandbox/iu.test(error.stderr ?? '')
        ? 'sandbox du navigateur indisponible'
        : error.code === 'ENOENT'
          ? 'le navigateur n’a pas produit de fichier'
          : 'échec du navigateur';
    throw new Error(
      `Export PDF impossible : ${detail}. Les autres exports sont conservés.`,
      { cause: error },
    );
  } finally {
    await rm(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
}
