import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  forceLinting,
  forEachDiagnostic,
  type Diagnostic,
} from '@codemirror/lint';
import { describe, expect, it, vi } from 'vitest';
import {
  extractLatexText,
  mapProofreadingRange,
} from '../src/proofreading/latexText';
import {
  createProofreadingExtension,
  proofreadingOccurrenceKey,
  splitProofreadingText,
} from '../src/proofreading/extension';

const visibleDiagnostics = (view: EditorView) => {
  const diagnostics: Diagnostic[] = [];
  forEachDiagnostic(view.state, (diagnostic) => diagnostics.push(diagnostic));
  return diagnostics;
};

describe('LaTeX-aware proofreading extraction', () => {
  it('keeps prose offsets and ignores commands, references, comments and math', () => {
    const source = String.raw`\documentclass{article}
\begin{document}
Les voiture sont rapide. \cite{internal-key}
% commentaire invisible
Une phrase avec $x + y = 3$ et une \textbf{partie importante}.
\begin{align}a &= b + c\end{align}
\end{document}`;
    const extraction = extractLatexText(source);
    expect(extraction.text).toContain('Les voiture sont rapide.');
    expect(extraction.text).toContain('partie importante');
    expect(extraction.text).not.toMatch(
      /documentclass|internal-key|commentaire|x \+ y|a &=/u,
    );

    const offset = extraction.text.indexOf('voiture');
    const range = mapProofreadingRange(extraction, offset, 'voiture'.length);
    expect(range).not.toBeNull();
    expect(source.slice(range!.from, range!.to)).toBe('voiture');
  });

  it('ignores verbatim environments and maps nested prose commands', () => {
    const source = String.raw`Avant \emph{texte humain}.
\begin{verbatim}\documentclass badword\end{verbatim}
Après.`;
    const extraction = extractLatexText(source);
    expect(extraction.text).toContain('texte humain');
    expect(extraction.text).not.toContain('badword');
  });

  it('chunks long prose without losing provider-to-source offsets', () => {
    const chunks = splitProofreadingText(
      'premier paragraphe\nsecond paragraphe',
      20,
    );
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      'premier paragraphe',
      'second paragraphe',
    ]);
    expect(chunks[1].offset).toBe('premier paragraphe\n'.length);
  });
});

describe('CodeMirror proofreading diagnostics', () => {
  it('maps a diagnostic and applies a suggestion as an editor transaction', async () => {
    const source = String.raw`\begin{document}Les voiture sont rapide.\end{document}`;
    const request = vi.fn(async (text: string) => ({
      language: 'fr',
      issues: [
        {
          offset: text.indexOf('voiture'),
          length: 'voiture'.length,
          message: 'Accord incorrect',
          type: 'grammar' as const,
          suggestions: [{ value: 'voitures' }],
        },
      ],
    }));
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: source,
        extensions: [createProofreadingExtension({ language: 'fr', request })],
      }),
    });
    try {
      view.dispatch({ changes: { from: source.length, insert: ' ' } });
      forceLinting(view);
      await vi.waitFor(() => expect(request).toHaveBeenCalled(), {
        timeout: 2_000,
      });
      let diagnostic: Diagnostic | undefined;
      await vi.waitFor(() => {
        forEachDiagnostic(view.state, (current) => {
          diagnostic = current;
        });
        expect(diagnostic).toBeDefined();
      });
      expect(diagnostic!.actions![0]).toMatchObject({
        name: 'Remplacer par « voitures »',
        markClass: 'frelated-proofreading-suggestion',
      });
      expect(diagnostic!.actions![1]).toMatchObject({
        markClass: 'frelated-proofreading-ignore',
      });
      diagnostic!.actions![0].apply(view, diagnostic!.from, diagnostic!.to);
      expect(view.state.doc.toString()).toContain('Les voitures sont rapide.');
    } finally {
      view.destroy();
    }
  });

  it('immediately hides an ignored occurrence and keeps it ignored after relinting', async () => {
    const source = String.raw`\begin{document}Les voiture sont rapide.\end{document}`;
    const request = vi.fn(async (text: string) => ({
      language: 'fr',
      issues: [
        {
          offset: text.indexOf('voiture'),
          length: 'voiture'.length,
          message: 'Accord incorrect',
          ruleId: 'GRAMMAR_AGREEMENT',
          type: 'grammar' as const,
          suggestions: [{ value: 'voitures' }],
        },
      ],
    }));
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: source,
        extensions: [createProofreadingExtension({ language: 'fr', request })],
      }),
    });

    try {
      forceLinting(view);
      await vi.waitFor(() => expect(visibleDiagnostics(view)).toHaveLength(1));
      const diagnostic = visibleDiagnostics(view)[0];
      const ignore = diagnostic.actions?.find(
        (action) => action.name === 'Ignorer cette occurrence',
      );
      expect(ignore).toBeDefined();

      ignore!.apply(view, diagnostic.from, diagnostic.to);
      expect(visibleDiagnostics(view)).toHaveLength(0);

      view.dispatch({ changes: { from: 0, insert: 'Titre\n' } });
      forceLinting(view);
      await vi.waitFor(
        () => {
          expect(request.mock.calls.length).toBeGreaterThanOrEqual(2);
          expect(visibleDiagnostics(view)).toHaveLength(0);
        },
        { timeout: 2_000 },
      );
    } finally {
      view.destroy();
    }
  });

  it('keeps an occurrence key stable when another line is inserted above it', () => {
    const source = 'Titre\nLes voiture sont rapide.';
    const from = source.indexOf('voiture');
    const shifted = `Préambule\n${source}`;
    const shiftedFrom = shifted.indexOf('voiture');

    expect(
      proofreadingOccurrenceKey(source, from, from + 7, 'GRAMMAR_AGREEMENT'),
    ).toBe(
      proofreadingOccurrenceKey(
        shifted,
        shiftedFrom,
        shiftedFrom + 7,
        'GRAMMAR_AGREEMENT',
      ),
    );
  });
});
