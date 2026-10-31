import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { config } from './config.js';

interface EncryptedValue {
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
  keyId: 'v1';
}

const masterKey = createHash('sha256')
  .update(config.dataEncryptionKey, 'utf8')
  .digest();
const scope = (projectId: string) => ['compilation', projectId];
const aad = (projectId: string) =>
  Buffer.from(scope(projectId).join('::'), 'utf8');
const scopedKey = (projectId: string) =>
  createHmac('sha256', masterKey)
    .update(scope(projectId).join('::'), 'utf8')
    .digest();

export const encode = (value: unknown, projectId: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', scopedKey(projectId), iv);
  cipher.setAAD(aad(projectId));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  const encrypted: EncryptedValue = {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    keyId: 'v1',
  };
  return JSON.stringify(encrypted);
};

export const decode = <T>(value: string, projectId: string): T => {
  const encrypted = JSON.parse(value) as EncryptedValue;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    scopedKey(projectId),
    Buffer.from(encrypted.iv, 'base64'),
  );
  decipher.setAAD(aad(projectId));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as T;
};
