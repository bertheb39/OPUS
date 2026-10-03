import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const dataDir = path.join(root, 'data');
export const publicDir = path.join(root, 'public');
