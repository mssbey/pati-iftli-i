import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR } from './db.js';

// Yayında Vercel Blob (BLOB_READ_WRITE_TOKEN), yerelde data/uploads kullanılır.
// Vercel'de Blob bağlanmamışsa fotoğraf (doğrulanmış, ≤3 MB) data URL olarak ilan kaydında saklanır.
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
const useBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
export const storageMode = () => (useBlob() ? 'blob' : process.env.VERCEL ? 'inline' : 'local');

export async function storeImage(bytes, ext, contentType) {
  const name = `${randomBytes(16).toString('hex')}.${ext}`;
  if (useBlob()) {
    const { put } = await import('@vercel/blob');
    const blob = await put(`listings/${name}`, bytes, { access: 'public', contentType, addRandomSuffix: false });
    return blob.url;
  }
  if (process.env.VERCEL) return `data:${contentType};base64,${bytes.toString('base64')}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(join(UPLOAD_DIR, name), bytes, { flag: 'wx' });
  return `/uploads/${name}`;
}

export async function deleteImage(url) {
  if (!url) return;
  if (url.startsWith('/uploads/')) return unlink(join(UPLOAD_DIR, url.slice('/uploads/'.length))).catch(() => {});
  if (useBlob()) {
    const { del } = await import('@vercel/blob');
    await del(url).catch(() => {});
  }
}
