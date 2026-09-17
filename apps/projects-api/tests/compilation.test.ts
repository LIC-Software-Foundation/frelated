import { describe, it, expect } from 'vitest';
import {
  fingerprint,
  makeSnapshot,
  settingsSchema,
} from '../src/compilation/model';
import { decode, encode } from '../src/compilation/queue';
import type { ProjectFile } from '../src/domain/models';
const tex = (name: string, content = 'hello'): ProjectFile => ({
  id: name,
  name,
  content,
  type: 'tex',
  createdAt: '2026-09-12',
});
const settings = settingsSchema.parse({});

describe('Compilation snapshots', () => {
  it('includes nested sources and bibliographies and detects their changes', () => {
    const files: ProjectFile[] = [
      tex('main.tex'),
      { ...tex('chapters'), type: 'folder', children: [tex('intro.tex')] },
      { ...tex('references.bib'), type: 'bib' },
    ];
    const first = makeSnapshot(files, settings);
    expect(first.sources.map((f) => f.path)).toEqual([
      'chapters/intro.tex',
      'main.tex',
      'references.bib',
    ]);
    files[2].content = 'changed';
    expect(fingerprint(first)).not.toBe(
      fingerprint(makeSnapshot(files, settings)),
    );
    expect(fingerprint(first)).not.toBe(
      fingerprint(makeSnapshot(files, { ...settings, engine: 'xelatex' })),
    );
  });
  it.each(['../main.tex', '/main.tex', '..', 'a\\b.tex', '-main.tex'])(
    'rejects unsafe names: %s',
    (name) => {
      expect(() => makeSnapshot([tex(name)], settings)).toThrow();
    },
  );
  it('requires an existing main document and unique paths', () => {
    expect(() => makeSnapshot([tex('chapter.tex')], settings)).toThrow();
    expect(() =>
      makeSnapshot([tex('main.tex'), tex('main.tex')], settings),
    ).toThrow();
  });
  it('explains an empty main document before queuing a job', () => {
    expect(() => makeSnapshot([tex('main.tex', '')], settings)).toThrow(
      'est vide',
    );
  });
  it('preserves binary image data', () => {
    const snapshot = makeSnapshot(
      [
        tex('main.tex'),
        { ...tex('figure.png', 'data:image/png;base64,AQID'), type: 'image' },
      ],
      settings,
    );
    expect(snapshot.sources[0]).toEqual({
      path: 'figure.png',
      content: 'AQID',
      binary: true,
    });
  });
  it('encrypts snapshots and binds ciphertext to its project', () => {
    const snapshot = makeSnapshot(
      [tex('main.tex', 'private document')],
      settings,
    );
    const encrypted = encode(snapshot, 'project-a');
    expect(encrypted).not.toContain('private document');
    expect(decode(encrypted, 'project-a')).toEqual(snapshot);
    expect(() => decode(encrypted, 'project-b')).toThrow();
  });
});
