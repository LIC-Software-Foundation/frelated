import { describe, expect, it } from 'vitest';
import { decode, encode } from './crypto.js';

describe('compilation payload encryption', () => {
  it('encrypts payloads and binds ciphertext to the project', () => {
    const snapshot = { privateDocument: 'contenu confidentiel' };
    const encrypted = encode(snapshot, 'project-a');
    expect(encrypted).not.toContain('contenu confidentiel');
    expect(decode(encrypted, 'project-a')).toEqual(snapshot);
    expect(() => decode(encrypted, 'project-b')).toThrow();
  });
});
