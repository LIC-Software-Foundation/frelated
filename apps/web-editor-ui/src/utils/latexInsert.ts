import { EditorView } from 'codemirror';

// ─── Primitives ───────────────────────────────────────────────────────────────

/**
 * Wraps the current selection (or `placeholder`) with `before` and `after`.
 * After insertion the wrapped content is selected so the user can type over it.
 */
export function insertWrapped(
  view: EditorView,
  before: string,
  after = '',
  placeholder = 'texte',
): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const inner = selected || placeholder;
  view.dispatch({
    changes: { from, to, insert: before + inner + after },
    selection: {
      anchor: from + before.length,
      head: from + before.length + inner.length,
    },
  });
  view.focus();
}

/**
 * Inserts `text` at the current cursor position (replaces any selection).
 * Cursor lands at the end of the inserted text.
 */
export function insertBlock(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  });
  view.focus();
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export const insertBold = (v: EditorView) =>
  insertWrapped(v, '\\textbf{', '}', 'texte');

export const insertItalic = (v: EditorView) =>
  insertWrapped(v, '\\textit{', '}', 'texte');

export const insertEmph = (v: EditorView) =>
  insertWrapped(v, '\\emph{', '}', 'texte');

export const insertUnderline = (v: EditorView) =>
  insertWrapped(v, '\\underline{', '}', 'texte');

// ─── Document structure ───────────────────────────────────────────────────────

export const insertSection = (v: EditorView) =>
  insertWrapped(v, '\n\\section{', '}', 'Introduction');

export const insertSubsection = (v: EditorView) =>
  insertWrapped(v, '\n\\subsection{', '}', 'Sous-section');

export const insertSubsubsection = (v: EditorView) =>
  insertWrapped(v, '\n\\subsubsection{', '}', 'Titre');

export const insertParagraph = (v: EditorView) =>
  insertWrapped(v, '\n\\paragraph{', '}', 'Paragraphe');

// ─── Mathematics ─────────────────────────────────────────────────────────────

export const insertInlineMath = (v: EditorView) =>
  insertWrapped(v, '$', '$', 'expression');

export const insertDisplayMath = (v: EditorView) =>
  insertBlock(v, '\n\\[\n  expression\n\\]\n');

export const insertEquation = (v: EditorView) =>
  insertBlock(v, '\n\\begin{equation}\n  \n\\end{equation}\n');

export const insertAlign = (v: EditorView) =>
  insertBlock(v, '\n\\begin{align}\n  a &= b \\\\\n  c &= d\n\\end{align}\n');

export const insertFraction = (v: EditorView) =>
  insertBlock(v, '\\frac{numérateur}{dénominateur}');

export const insertSqrt = (v: EditorView) =>
  insertWrapped(v, '\\sqrt{', '}', 'expression');

export const insertSum = (v: EditorView) => insertBlock(v, '\\sum_{i=1}^{n}');

export const insertIntegral = (v: EditorView) =>
  insertBlock(v, '\\int_{a}^{b} f(x) \\, dx');

export const insertSubscript = (v: EditorView) =>
  insertWrapped(v, '_{', '}', 'i');

export const insertSuperscript = (v: EditorView) =>
  insertWrapped(v, '^{', '}', 'n');

// ─── Lists ────────────────────────────────────────────────────────────────────

export const insertItemize = (v: EditorView) =>
  insertBlock(
    v,
    '\n\\begin{itemize}\n  \\item Premier élément\n  \\item Deuxième élément\n\\end{itemize}\n',
  );

export const insertEnumerate = (v: EditorView) =>
  insertBlock(
    v,
    '\n\\begin{enumerate}\n  \\item Premier élément\n  \\item Deuxième élément\n\\end{enumerate}\n',
  );

export const insertDescription = (v: EditorView) =>
  insertBlock(
    v,
    '\n\\begin{description}\n  \\item[Terme] Définition\n\\end{description}\n',
  );

export const insertItem = (v: EditorView) => insertBlock(v, '\\item ');

// ─── Tables ───────────────────────────────────────────────────────────────────

export function insertTable(v: EditorView, rows: number, cols: number): void {
  const colSpec = Array(cols).fill('c').join(' | ');
  const header =
    Array.from({ length: cols }, (_, i) => `Col ${i + 1}`).join(' & ') +
    ' \\\\';
  const dataRow = Array(cols).fill('Donnée').join(' & ') + ' \\\\';
  const dataRows = Array(rows - 1)
    .fill(`    ${dataRow}`)
    .join('\n');

  const text =
    '\n\\begin{table}[h]\n' +
    '  \\centering\n' +
    `  \\begin{tabular}{${colSpec}}\n` +
    '    \\hline\n' +
    `    ${header}\n` +
    '    \\hline\n' +
    `${dataRows}\n` +
    '    \\hline\n' +
    '  \\end{tabular}\n' +
    '  \\caption{Titre du tableau}\n' +
    '  \\label{tab:label}\n' +
    '\\end{table}\n';

  insertBlock(v, text);
}

// ─── Environments / insert ────────────────────────────────────────────────────

export const insertFigure = (v: EditorView) =>
  insertBlock(
    v,
    '\n\\begin{figure}[h]\n' +
      '  \\centering\n' +
      '  \\includegraphics[width=0.8\\linewidth]{image}\n' +
      '  \\caption{Légende}\n' +
      '  \\label{fig:label}\n' +
      '\\end{figure}\n',
  );

export const insertAbstract = (v: EditorView) =>
  insertBlock(
    v,
    '\n\\begin{abstract}\n  Résumé de votre article ici.\n\\end{abstract}\n',
  );

export const insertQuote = (v: EditorView) =>
  insertBlock(v, '\n\\begin{quote}\n  Citation ici.\n\\end{quote}\n');

export const insertCenter = (v: EditorView) =>
  insertBlock(v, '\n\\begin{center}\n  Contenu centré\n\\end{center}\n');

export const insertVerbatim = (v: EditorView) =>
  insertBlock(v, '\n\\begin{verbatim}\ncode ici\n\\end{verbatim}\n');

// ─── References ───────────────────────────────────────────────────────────────

export const insertLabel = (v: EditorView) =>
  insertWrapped(v, '\\label{', '}', 'sec:label');

export const insertRef = (v: EditorView) =>
  insertWrapped(v, '\\ref{', '}', 'sec:label');

export const insertCite = (v: EditorView) =>
  insertWrapped(v, '\\cite{', '}', 'auteur2023');

export const insertFootnote = (v: EditorView) =>
  insertWrapped(v, '\\footnote{', '}', 'note de bas de page');
