// Yerel geliştirme sunucusu. Vercel'de statik dosyaları platform, API'yi api/index.js sunar.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { ready } from './db.js';
import { UPLOAD_DIR } from './storage.js';
import { handleApi, PAYMENT_MODE } from './api.js';

const PORT = Number(process.env.PORT) || 3000;
const DIST = join(import.meta.dirname, '..', 'dist');
const VERCEL_CONFIG = JSON.parse(await readFile(join(import.meta.dirname, '..', 'vercel.json'), 'utf8'));
// Güvenlik başlıkları tek yerde: vercel.json
const SECURITY_HEADERS = VERCEL_CONFIG.headers.find(h => h.source === '/(.*)').headers;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

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
  for (const { key, value } of SECURITY_HEADERS) res.setHeader(key, value);
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

await ready();
server.listen(PORT, () => {
  console.log(`Pati Çiftliği çalışıyor → http://localhost:${PORT}`);
  console.log(`Veritabanı: ${process.env.DATABASE_URL || process.env.POSTGRES_URL ? 'Postgres (DATABASE_URL)' : 'yerel PGlite (data/pg)'}`);
  console.log(`Ödeme modu: ${PAYMENT_MODE}${PAYMENT_MODE === 'test' ? ' (tahsilat yapılmaz)' : ''}`);
});
