import {
  forEachDiagnostic,
  forceLinting,
  lintGutter,
  linter,
  setDiagnostics,
  type Action,
  type Diagnostic,
} from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { checkProofreading } from './service';
import { extractLatexText, mapProofreadingRange } from './latexText';

export interface ProofreadingExtensionOptions {
  language: 'fr' | 'en' | 'auto';
  request?: typeof checkProofreading;
}

export const proofreadingOccurrenceKey = (
  source: string,
  from: number,
  to: number,
  rule: string,
) => {
  const lineStart = source.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
  const nextLineBreak = source.indexOf('\n', to);
  const lineEnd = nextLineBreak < 0 ? source.length : nextLineBreak;
  return [
    rule,
    from - lineStart,
    source.slice(from, to).trim().toLowerCase(),
    source.slice(lineStart, lineEnd).trim(),
  ].join(':');
};

const removeVisibleDiagnostics = (
  editor: EditorView,
  ignored: (diagnostic: Diagnostic, from: number, to: number) => boolean,
) => {
  const remaining: Diagnostic[] = [];
  forEachDiagnostic(editor.state, (diagnostic, from, to) => {
    if (!ignored(diagnostic, from, to)) {
      remaining.push({ ...diagnostic, from, to });
    }
  });
  editor.dispatch(setDiagnostics(editor.state, remaining));
};

export const splitProofreadingText = (text: string, maximum = 40_000) => {
  const chunks: Array<{ text: string; offset: number }> = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(text.length, offset + maximum);
    if (end < text.length) {
      const breakAt = Math.max(
        text.lastIndexOf('\n', end),
        text.lastIndexOf(' ', end),
      );
      if (breakAt > offset + Math.floor(maximum / 2)) end = breakAt + 1;
    }
    const raw = text.slice(offset, end);
    const leading = raw.length - raw.trimStart().length;
    const value = raw.trim();
    if (value) chunks.push({ text: value, offset: offset + leading });
    offset = end;
  }
  return chunks;
};

export const createProofreadingExtension = ({
  language,
  request = checkProofreading,
}: ProofreadingExtensionOptions): Extension => {
  let controller: AbortController | undefined;
  let generation = 0;
  const ignoredOccurrences = new Set<string>();
  const ignoredWords = new Set<string>();

  return [
    lintGutter(),
    linter(
      async (view): Promise<Diagnostic[]> => {
        controller?.abort();
        controller = new AbortController();
        const currentGeneration = ++generation;
        const source = view.state.doc.toString();
        const extraction = extractLatexText(source);
        const chunks = splitProofreadingText(extraction.text);
        if (chunks.length === 0) return [];
        try {
          const results = await Promise.all(
            chunks.map(async (chunk) => ({
              chunk,
              result: await request(chunk.text, language, controller!.signal),
            })),
          );
          if (currentGeneration !== generation) return [];
          return results.flatMap(({ chunk, result }) =>
            result.issues.flatMap((issue) => {
              const range = mapProofreadingRange(
                extraction,
                issue.offset + chunk.offset,
                issue.length,
              );
              if (!range) return [];
              const occurrence = proofreadingOccurrenceKey(
                source,
                range.from,
                range.to,
                issue.ruleId ?? issue.message,
              );
              const word = source
                .slice(range.from, range.to)
                .trim()
                .toLowerCase();
              if (
                ignoredOccurrences.has(occurrence) ||
                ignoredWords.has(word)
              ) {
                return [];
              }
              const actions: Action[] = issue.suggestions
                .slice(0, 5)
                .map((suggestion) => ({
                  name: `Remplacer par « ${suggestion.value} »`,
                  markClass: 'frelated-proofreading-suggestion',
                  apply(editor, from, to) {
                    editor.dispatch({
                      changes: { from, to, insert: suggestion.value },
                    });
                  },
                }));
              actions.push({
                name: 'Ignorer cette occurrence',
                markClass: 'frelated-proofreading-ignore',
                apply(editor, from, to) {
                  ignoredOccurrences.add(occurrence);
                  removeVisibleDiagnostics(
                    editor,
                    (_diagnostic, currentFrom, currentTo) =>
                      currentFrom === from && currentTo === to,
                  );
                  forceLinting(editor);
                },
              });
              if (word && !/\s/u.test(word)) {
                actions.push({
                  name: 'Ignorer ce mot pendant la session',
                  markClass: 'frelated-proofreading-ignore',
                  apply(editor) {
                    ignoredWords.add(word);
                    removeVisibleDiagnostics(
                      editor,
                      (_diagnostic, from, to) =>
                        editor.state.sliceDoc(from, to).trim().toLowerCase() ===
                        word,
                    );
                    forceLinting(editor);
                  },
                });
              }
              return [
                {
                  from: range.from,
                  to: range.to,
                  severity:
                    issue.type === 'style'
                      ? ('info' as const)
                      : ('warning' as const),
                  message: issue.ruleId
                    ? `${issue.message} (${issue.ruleId})`
                    : issue.message,
                  source: issue.category || 'Correcteur',
                  actions,
                },
              ];
            }),
          );
        } catch (error) {
          if ((error as Error).name !== 'AbortError') {
            console.warn('Correcteur linguistique indisponible', error);
          }
          return [];
        }
      },
      { delay: 650 },
    ),
  ];
};
