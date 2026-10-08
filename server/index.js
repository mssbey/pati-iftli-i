import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, extname, normalize, sep } from 'node:path';
import { db, UPLOAD_DIR } from './db.js';
import { handleApi, PAYMENT_MODE } from './api.js';
import { hashPassword } from './security.js';

const PORT = Number(process.env.PORT) || 3000;
const PROD = process.env.NODE_ENV === 'production';
const DIST = join(import.meta.dirname, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", "img-src 'self' data: blob: https://images.unsplash.com",
    "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

async function ensureAdmin() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = 'Çiftlik Yöneticisi' } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    const email = ADMIN_EMAIL.trim().toLowerCase();
    const hash = await hashPassword(ADMIN_PASSWORD);
    db.prepare(`INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'admin')
      ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, role = 'admin'`).run(email, ADMIN_NAME, hash);
    return;
  }
  if (PROD || db.prepare(`SELECT 1 FROM users WHERE role = 'admin'`).get()) return;
  const password = randomBytes(9).toString('base64url');
  db.prepare(`INSERT OR IGNORE INTO users (email, name, password_hash, role) VALUES ('admin@pati.local', ?, ?, 'admin')`)
    .run(ADMIN_NAME, await hashPassword(password));
  console.log(`\n  Geliştirme yöneticisi oluşturuldu → admin@pati.local / ${password}`);
  console.log('  (Kalıcı yönetici için .env dosyasına ADMIN_EMAIL ve ADMIN_PASSWORD ekleyin.)\n');
}

async function serveFile(res, file, cache) {
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bulunamadı');
  }
}

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }
    if (url.pathname.startsWith('/uploads/')) {
      const name = url.pathname.slice('/uploads/'.length);
      if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(name)) {
        res.writeHead(404);
        return res.end();
      }
      return await serveFile(res, join(UPLOAD_DIR, name), 'public, max-age=86400, immutable');
    }
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(DIST, path));
    if (!file.startsWith(DIST + sep)) {
      res.writeHead(403);
      return res.end();
    }
    await serveFile(res, file, file.endsWith('.html') ? 'no-cache' : 'public, max-age=300');
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(400);
    res.end();
  }
});

await ensureAdmin();
server.listen(PORT, () => {
  console.log(`Pati Çiftliği çalışıyor → http://localhost:${PORT}`);
  console.log(`Ödeme modu: ${PAYMENT_MODE}${PAYMENT_MODE === 'test' ? ' (tahsilat yapılmaz)' : ''}`);
});
