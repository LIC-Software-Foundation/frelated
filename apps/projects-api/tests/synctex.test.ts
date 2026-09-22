import { describe, expect, it } from 'vitest';
import {
  findSyncSource,
  parseSyncTexFields,
  pdfSearchCandidates,
  sourceSearchCandidates,
} from '../src/compilation/synctex';
import type { Snapshot } from '../src/compilation/model';

const snapshot: Snapshot = {
  settings: { mainFile: 'main.tex', engine: 'pdflatex' },
  sources: [
    { path: 'main.tex', content: 'Main', binary: false },
    {
      path: 'chapters/introduction avec espaces.tex',
      content: 'Texte',
      binary: false,
    },
  ],
};

describe('SyncTeX safety and parsing', () => {
  it('accepts a known path containing spaces', () => {
    expect(
      findSyncSource(snapshot, 'chapters/introduction avec espaces.tex').path,
    ).toContain('espaces.tex');
  });

  it.each(['../main.tex', '/main.tex', '-output.tex', 'missing.tex'])(
    'rejects unknown or unsafe paths: %s',
    (file) => expect(() => findSyncSource(snapshot, file)).toThrow(),
  );

  it('parses official CLI fields without evaluating output', () => {
    const fields = parseSyncTexFields(
      'SyncTeX result begin\nPage:3\nx:120.5\ny:80\nW:42\nH:11\nSyncTeX result end',
    );
    expect(fields.get('Page')).toBe('3');
    expect(fields.get('x')).toBe('120.5');
  });

  it('falls back to nearby printable source lines without leaving the file', () => {
    expect(
      sourceSearchCandidates('first\n\nthird', { line: 2, column: 4 }),
    ).toEqual([
      { line: 2, column: 5 },
      { line: 2, column: 0 },
      { line: 1, column: 0 },
      { line: 3, column: 0 },
    ]);
  });

  it('looks around an empty PDF point and keeps coordinates positive', () => {
    const candidates = pdfSearchCandidates({ x: 4, y: 3 });
    expect(candidates[0]).toEqual({ x: 4, y: 3 });
    expect(candidates).toContainEqual({ x: 0, y: 3 });
    expect(candidates).toContainEqual({ x: 4, y: 0 });
  });
});
