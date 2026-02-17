import { existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { IMAGES_DIR } from '../config.js';

export function listImages(): string[] {
  if (!existsSync(IMAGES_DIR)) return [];
  return readdirSync(IMAGES_DIR).filter((f) => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
}

export function deleteImage(filename: string): boolean {
  const path = join(IMAGES_DIR, filename);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function getImageStats(): { count: number; totalSizeMB: number } {
  const files = listImages();
  let totalSize = 0;
  for (const f of files) {
    try {
      totalSize += statSync(join(IMAGES_DIR, f)).size;
    } catch { /* skip */ }
  }
  return { count: files.length, totalSizeMB: Math.round((totalSize / 1024 / 1024) * 100) / 100 };
}
