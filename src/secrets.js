import fs from 'node:fs';
import path from 'node:path';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { dataDir } from './paths.js';

const scrypt = promisify(scryptCallback);
const keyPath = path.join(dataDir, 'secret.key');

export function loadKey() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(keyPath)) {
    fs.writeFileSync(keyPath, randomBytes(32));
  }
  const key = fs.readFileSync(keyPath);
  if (key.length !== 32) throw new Error('Clé de chiffrement invalide.');
  return key;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [kind, saltHex, hashHex] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function encryptText(plain, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}.${tag.toString('hex')}.${encrypted.toString('hex')}`;
}

export function decryptText(payload, key) {
  const [ivHex, tagHex, dataHex] = String(payload || '').split('.');
  if (!ivHex || !tagHex || !dataHex) throw new Error('Secret illisible.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}
