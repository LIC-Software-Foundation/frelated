import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { env } from '../config/env';

export interface EncryptedValue {
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
  keyId: string;
}

const DEFAULT_DEV_SECRET = 'frelated-dev-auth-secret-change-me';
const KEY_ID = 'v1';

let warnedWeakFallback = false;

const getMasterSecret = (): Buffer => {
  const configuredSecret = env.dataEncryptionKey || env.authSecret;

  if (
    !warnedWeakFallback &&
    !env.dataEncryptionKey &&
    configuredSecret === DEFAULT_DEV_SECRET
  ) {
    warnedWeakFallback = true;
    console.warn(
      '[security] DATA_ENCRYPTION_KEY is not configured; MongoDB data protection is using the default development secret.',
    );
  }

  return createHash('sha256').update(configuredSecret, 'utf8').digest();
};

const deriveScopedKey = (...scope: string[]): Buffer => {
  const hmac = createHmac('sha256', getMasterSecret());
  hmac.update(scope.join('::'), 'utf8');
  return hmac.digest();
};

const toAad = (scope: string[]) => Buffer.from(scope.join('::'), 'utf8');

export const encryptString = (
  plaintext: string,
  ...scope: string[]
): EncryptedValue => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveScopedKey(...scope), iv);
  cipher.setAAD(toAad(scope));

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    keyId: KEY_ID,
  };
};

export const decryptString = (
  payload: EncryptedValue,
  ...scope: string[]
): string => {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveScopedKey(...scope),
    Buffer.from(payload.iv, 'base64'),
  );
  decipher.setAAD(toAad(scope));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
};
