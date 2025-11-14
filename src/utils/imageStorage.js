// src/utils/imageStorage.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const IMAGE_DIR = path.resolve(__dirname, '..', '..', 'uploads', 'card-img');
export const IMAGE_PUBLIC_PREFIX = '/img';

// Ensure that the directory exists at module load (idempotent)
if (!fs.existsSync(IMAGE_DIR)) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

export function buildImageUrl(fileName) {
  return fileName ? `${IMAGE_PUBLIC_PREFIX}/${fileName}` : null;
}
