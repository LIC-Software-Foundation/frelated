import { spawn } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  chown,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Snapshot, CompilationResult } from './model';

export async function compileSnapshot(
  snapshot: Snapshot,
): Promise<{ result: CompilationResult; pdf?: string }> {
  const started = Date.now();
  const work = await mkdtemp(path.join(tmpdir(), 'frelated-tex-'));
  const output = path.join(work, 'output');
  let logs = '';
  try {
    await mkdir(output);
    const root = process.getuid?.() === 0;
    if (root) {
      await chown(work, 65534, 65534);
      await chown(output, 65534, 65534);
    }
    for (const source of snapshot.sources) {
      const target = path.resolve(work, source.path);
      if (!target.startsWith(work + path.sep))
        throw new Error('Chemin de fichier invalide.');
      await mkdir(path.dirname(target), { recursive: true });
      const content =
        !source.binary && snapshot.settings.engine === 'pdflatex'
          ? source.content
              // pdfLaTeX does not define these typographic Unicode spaces by
              // default. Treat them as ordinary spacing, as browser/office
              // copy-paste users expect.
              .replace(/[\u202F\u00A0]/gu, ' ')
          : source.content;
      await writeFile(
        target,
        Buffer.from(content, source.binary ? 'base64' : 'utf8'),
      );
    }
    const engine = snapshot.settings.engine;
    const mode = {
      pdflatex: '-pdf',
      xelatex: '-xelatex',
      lualatex: '-lualatex',
    }[engine];
    // Never load a project's latexmkrc (Perl code) or honor first-line engine options.
    const command = `${engine} -no-shell-escape -no-parse-first-line ${engine === 'lualatex' ? '--safer --nosocket ' : ''}%O %S`;
    const runLatex = (haltOnError: boolean) =>
      new Promise<number>((resolve, reject) => {
        const child = spawn(
          'latexmk',
          [
            '-norc',
            mode,
            `-${engine}=${command}`,
            '-interaction=nonstopmode',
            ...(haltOnError ? ['-halt-on-error'] : ['-f', '-g']),
            '-file-line-error',
            '-outdir=output',
            './' + snapshot.settings.mainFile,
          ],
          {
            cwd: work,
            detached: true,
            ...(root ? { uid: 65534, gid: 65534 } : {}),
            env: {
              PATH: process.env.PATH,
              HOME: work,
              LANG: 'C.UTF-8',
              TEXMFVAR: path.join(output, 'texmf-var'),
              TEXMFCONFIG: path.join(output, 'texmf-config'),
              openin_any: 'p',
              openout_any: 'p',
              shell_escape: 'f',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        const timeout = setTimeout(
          () => {
            if (child.pid) {
              try {
                process.kill(-child.pid, 'SIGKILL');
              } catch {
                /* exited */
              }
            }
            logs += '\nDélai de compilation dépassé.';
          },
          Math.max(1000, Number(process.env.COMPILATION_TIMEOUT_MS) || 120000),
        );
        const append = (data: Buffer) => {
          logs = (logs + data.toString()).slice(-128000);
        };
        child.stdout.on('data', append);
        child.stderr.on('data', append);
        child.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.on('close', (code) => {
          clearTimeout(timeout);
          resolve(code ?? 1);
        });
      });
    let code = await runLatex(true);
    const missingImageDetected =
      /File [`'].+?[`'] not found/u.test(logs) ||
      /Package (?:pdftex|luatex|xetex)\.def Error: File [`']/u.test(logs);
    const recoverableLineBreakDetected =
      /LaTeX Error: There's no line here to end\./u.test(logs);
    let recoverableErrorsTolerated = false;
    if (code !== 0 && (missingImageDetected || recoverableLineBreakDetected)) {
      logs += missingImageDetected
        ? '\nImage manquante détectée : nouvelle tentative avec un emplacement de substitution.\n'
        : '\nErreur de saut de ligne récupérable : nouvelle tentative en mode tolérant.\n';
      const retryStart = logs.length;
      code = await runLatex(false);
      const retryLogs = logs.slice(retryStart);
      const unexpectedError = retryLogs.split('\n').some(
        (line) =>
          /Undefined control sequence|Emergency stop|Fatal error|LaTeX Error:/u.test(
            line.replace(/LaTeX Error: There's no line here to end\./u, ''),
          ) ||
          (/Package .+ Error:/u.test(line) &&
            // TeX wraps long filenames in terminal output, sometimes
            // splitting "not found" across lines. The graphics drivers only
            // emit this shape when substituting a missing graphic in draft
            // mode, so it is safe to tolerate without matching the suffix.
            !/Package (?:pdftex|luatex|xetex)\.def Error: File [`']/u.test(
              line,
            )),
      );
      recoverableErrorsTolerated = !unexpectedError;
    }
    const pdfPath = path.join(
      output,
      path.basename(snapshot.settings.mainFile, '.tex') + '.pdf',
    );
    if ((await stat(pdfPath)).size > 20 * 1024 * 1024)
      throw new Error('PDF trop volumineux (20 Mo maximum).');
    const pdf = await readFile(pdfPath);
    if (pdf.subarray(0, 5).toString() !== '%PDF-')
      throw new Error('PDF invalide.');
    if (code !== 0 && !recoverableErrorsTolerated)
      throw new Error('Échec de compilation LaTeX.');
    return {
      result: {
        status: 'success',
        logs: [
          {
            level: recoverableErrorsTolerated ? 'warning' : 'info',
            message: recoverableErrorsTolerated
              ? `${logs}\n${
                  missingImageDetected
                    ? 'Le PDF a été généré avec un emplacement de substitution pour chaque image introuvable.'
                    : 'Le PDF a été généré malgré une erreur de saut de ligne récupérable.'
                }`
              : logs,
          },
        ],
        compiledAt: new Date().toISOString(),
        durationMs: Date.now() - started,
      },
      pdf: pdf.toString('base64'),
    };
  } catch (error) {
    return {
      result: {
        status: 'error',
        logs: [
          {
            level: 'error',
            message: `${logs}\n${error instanceof Error ? error.message : 'Compilation impossible.'}`,
          },
        ],
        compiledAt: new Date().toISOString(),
        durationMs: Date.now() - started,
      },
    };
  } finally {
    await rm(work, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    }).catch((error) => {
      // Cleanup must not discard a successful PDF or hide the original TeX log.
      console.warn('[latex cleanup]', error.code);
    });
  }
}
