import { writeFile, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { db, tx, balanceOf, UPLOAD_DIR } from './db.js';
import { hashPassword, verifyPassword, newToken, sha256 } from './security.js';

const PROD = process.env.NODE_ENV === 'production';
const SECURE_COOKIE = PROD || process.env.COOKIE_SECURE === '1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
// 'test': yerel geliştirme için tahsilatsız test ödemesi. 'none': ödeme kapalı.
// iyzico / PayTR bağlandığında sağlayıcı adı burada seçilecek.
export const PAYMENT_MODE = process.env.PAYMENT_PROVIDER || (PROD ? 'none' : 'test');

export const COSTS = { listing: 5, feature: 10 };
export const FEATURE_DAYS = 7;
export const PACKAGES = [
  { id: 'baslangic', name: 'Başlangıç', credits: 20, price: 99, note: '4 ilan için yeterli' },
  { id: 'standart', name: 'Standart', credits: 50, price: 199, note: '10 ilan ya da 5 öne çıkarma', popular: true },
  { id: 'buyuk', name: 'Büyük', credits: 100, price: 349, note: 'Yoğun ilan verenler için' },
];

const COOKIE = 'pati_sid';
const SESSION_DAYS = 30;
const TZ = '+3 hours'; // Türkiye saati (UTC+3) ile günlük raporlar
const CATEGORIES = ['adoption', 'mate', 'lost', 'accessory'];
const ANIMALS = ['dog', 'cat', 'other'];
const DUMMY_HASH = await hashPassword(randomBytes(12).toString('hex'));

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------- yardımcılar ---------- */

const routes = [];
function route(method, path, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '(\\d+)')) + '$');
  routes.push({ method, re, keys, handler, auth: false, admin: false, limit: 64 * 1024, status: 200, ...opts });
}

function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return req.headers['x-forwarded-for'].split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

const attempts = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  if (attempts.size > 5000) for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
  let entry = attempts.get(key);
  if (!entry || entry.reset < now) attempts.set(key, (entry = { count: 0, reset: now + windowMs }));
  if (++entry.count > max) throw new HttpError(429, 'Çok fazla deneme yaptınız. Lütfen biraz sonra tekrar deneyin.');
}

async function readBody(req, limit) {
  if (!(req.headers['content-type'] || '').startsWith('application/json'))
    throw new HttpError(415, 'İstek JSON biçiminde olmalı.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Gönderilen veri çok büyük.');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return body && typeof body === 'object' ? body : {};
  } catch {
    throw new HttpError(400, 'Geçersiz istek gövdesi.');
  }
}

function text(value, label, { min = 1, max = 200 } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (v.length < min) throw new HttpError(400, `${label} alanını doldurun.`);
  if (v.length > max) throw new HttpError(400, `${label} en fazla ${max} karakter olabilir.`);
  return v;
}

function email(value) {
  const v = text(value, 'E-posta', { max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new HttpError(400, 'Geçerli bir e-posta adresi girin.');
  return v;
}

function oneOf(value, list, label) {
  if (!list.includes(value)) throw new HttpError(400, `Geçersiz ${label}.`);
  return value;
}

function sessionToken(req) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

function currentUser(req) {
  const token = sessionToken(req);
  if (!token) return null;
  return db.prepare(`SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(token), Date.now()) || null;
}

function startSession(res, userId) {
  const token = newToken();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, Date.now() + SESSION_DAYS * 864e5);
  res.setHeader('Set-Cookie', cookie(token, SESSION_DAYS * 86400));
}

const cookie = (value, maxAge) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE_COOKIE ? '; Secure' : ''}`;

function account(userId) {
  const user = db.prepare('SELECT id, name, email, role, created_at AS createdAt FROM users WHERE id = ?').get(userId);
  return { user, balance: balanceOf(userId) };
}

const shortName = name => {
  const [first, ...rest] = String(name || 'Üye').split(/\s+/);
  return rest.length ? `${first} ${rest.at(-1)[0]}.` : first;
};

const LISTING_SQL = `SELECT l.*, u.name AS owner_name, u.email AS owner_email,
  (l.featured_until IS NOT NULL AND l.featured_until > datetime('now')) AS featured
  FROM listings l LEFT JOIN users u ON u.id = l.user_id`;

function shapeListing(l, { full = false, admin = false } = {}) {
  return {
    id: l.id, title: l.title, category: l.category, animal: l.animal, breed: l.breed, city: l.city,
    age: l.age, sex: l.sex, photo: l.photo, featured: !!l.featured, isSample: !!l.is_sample,
    status: l.status, createdAt: l.created_at,
    owner: l.is_sample ? 'Pati Çiftliği (örnek)' : shortName(l.owner_name),
    ...(full && { description: l.description, featuredUntil: l.featured_until, rejectReason: l.reject_reason }),
    ...(admin && { ownerEmail: l.owner_email, ownerName: l.owner_name }),
  };
}

const IMAGE_TYPES = [
  { ext: 'jpg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', test: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

// Fotoğraf data URL olarak gelir; tür, bildirilen MIME'a değil dosyanın ilk baytlarına göre doğrulanır.
async function savePhoto(dataUrl) {
  if (dataUrl == null || dataUrl === '') return null;
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new HttpError(400, 'Fotoğraf JPG, PNG veya WEBP olmalı.');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length > 3 * 1024 * 1024) throw new HttpError(413, 'Fotoğraf en fazla 3 MB olabilir.');
  const type = IMAGE_TYPES.find(t => t.test(bytes));
  if (!type) throw new HttpError(400, 'Fotoğraf dosyası tanınamadı.');
  const name = `${randomBytes(16).toString('hex')}.${type.ext}`;
  await writeFile(join(UPLOAD_DIR, name), bytes, { flag: 'wx' });
  return `/uploads/${name}`;
}

function findListing(id) {
  const l = db.prepare(`${LISTING_SQL} WHERE l.id = ?`).get(id);
  if (!l || l.status === 'removed') throw new HttpError(404, 'İlan bulunamadı.');
  return l;
}

/* ---------- genel ---------- */

route('GET', '/api/config', () => ({ packages: PACKAGES, costs: COSTS, featureDays: FEATURE_DAYS, paymentMode: PAYMENT_MODE }));

route('GET', '/api/stats', () => {
  const rows = db.prepare(`SELECT category, COUNT(*) AS n FROM listings WHERE status = 'approved' GROUP BY category`).all();
  const counts = Object.fromEntries(CATEGORIES.map(c => [c, 0]));
  for (const r of rows) counts[r.category] = r.n;
  const cities = db.prepare(`SELECT COUNT(DISTINCT city) AS n FROM listings WHERE status = 'approved'`).get().n;
  return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0), cities };
});

/* ---------- üyelik ---------- */

route('POST', '/api/auth/register', async ({ req, res, body }) => {
  rateLimit('register:' + clientIp(req), 10, 3600e3);
  const name = text(body.name, 'Ad soyad', { min: 2, max: 60 });
  const mail = email(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 8 || password.length > 128) throw new HttpError(400, 'Şifre en az 8 karakter olmalı.');
  if (body.terms !== true) throw new HttpError(400, 'Devam etmek için kullanım koşullarını onaylayın.');
  const hash = await hashPassword(password);
  let id;
  try {
    id = Number(db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run(mail, name, hash).lastInsertRowid);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'Bu e-posta ile kayıtlı bir hesap zaten var.');
    throw error;
  }
  startSession(res, id);
  return account(id);
}, { status: 201 });

route('POST', '/api/auth/login', async ({ req, res, body }) => {
  rateLimit('login:' + clientIp(req), 10, 15 * 60e3);
  const mail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(mail);
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'E-posta veya şifre hatalı.');
  startSession(res, user.id);
  return account(user.id);
});

route('POST', '/api/auth/logout', ({ req, res }) => {
  const token = sessionToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.setHeader('Set-Cookie', cookie('', 0));
  return { ok: true };
});

route('GET', '/api/auth/me', ({ user }) => (user ? account(user.id) : { user: null, balance: 0 }));

/* ---------- ilanlar ---------- */

route('GET', '/api/listings', ({ query }) => {
  const where = [`l.status = 'approved'`];
  const args = [];
  for (const key of ['category', 'animal', 'breed', 'city']) {
    const v = query.get(key);
    if (v && v !== 'all') { where.push(`l.${key} = ?`); args.push(v); }
  }
  const q = (query.get('q') || '').trim().slice(0, 60).replace(/[%_]/g, '');
  if (q) {
    where.push('(l.title LIKE ? OR l.breed LIKE ? OR l.city LIKE ? OR l.description LIKE ?)');
    args.push(...Array(4).fill(`%${q}%`));
  }
  if (query.get('featured') === '1') where.push(`l.featured_until > datetime('now')`);
  const exclude = Number(query.get('exclude'));
  if (exclude) { where.push('l.id <> ?'); args.push(exclude); }
  const limit = Math.min(Math.max(Number(query.get('limit')) || 48, 1), 100);
  const rows = db.prepare(`${LISTING_SQL} WHERE ${where.join(' AND ')} ORDER BY featured DESC, l.created_at DESC, l.id DESC LIMIT ${limit}`).all(...args);
  return { listings: rows.map(l => shapeListing(l)) };
});

route('GET', '/api/listings/facets', () => ({
  breeds: db.prepare(`SELECT DISTINCT breed FROM listings WHERE status = 'approved' ORDER BY breed`).all().map(r => r.breed),
  cities: db.prepare(`SELECT DISTINCT city FROM listings WHERE status = 'approved' ORDER BY city`).all().map(r => r.city),
}));

route('GET', '/api/listings/:id', ({ params, user }) => {
  const l = findListing(params.id);
  const canSee = l.status === 'approved' || (user && (user.id === l.user_id || user.role === 'admin'));
  if (!canSee) throw new HttpError(404, 'İlan bulunamadı.');
  return { listing: shapeListing(l, { full: true }), mine: !!user && user.id === l.user_id };
});

route('POST', '/api/listings', async ({ body, user }) => {
  const fields = {
    title: text(body.title, 'İlan başlığı', { min: 5, max: 90 }),
    category: oneOf(body.category, CATEGORIES, 'kategori'),
    animal: oneOf(body.animal, ANIMALS, 'tür'),
    breed: text(body.breed, 'Irk', { max: 50 }),
    city: text(body.city, 'Şehir', { max: 40 }),
    age: text(body.age, 'Yaş', { min: 0, max: 30 }),
    sex: text(body.sex, 'Cinsiyet', { min: 0, max: 20 }),
    description: text(body.description, 'Açıklama', { min: 20, max: 3000 }),
  };
  const photo = await savePhoto(body.photo);
  try {
    return tx(() => {
      if (balanceOf(user.id) < COSTS.listing)
        throw new HttpError(402, `İlan vermek için ${COSTS.listing} kredi gerekiyor. Kredi yükleyerek devam edebilirsiniz.`);
      const id = Number(db.prepare(`INSERT INTO listings (user_id, title, category, animal, breed, city, age, sex, description, photo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, ...Object.values(fields), photo).lastInsertRowid);
      db.prepare('INSERT INTO credit_ledger (user_id, amount, reason, ref) VALUES (?, ?, ?, ?)')
        .run(user.id, -COSTS.listing, `İlan oluşturma #${id}`, `listing:${id}`);
      return { listing: shapeListing(findListing(id), { full: true }), balance: balanceOf(user.id) };
    });
  } catch (error) {
    if (photo) await unlink(join(UPLOAD_DIR, photo.split('/').pop())).catch(() => {});
    throw error;
  }
}, { auth: true, limit: 5 * 1024 * 1024, status: 201 });

route('POST', '/api/listings/:id/feature', ({ params, body, user }) => {
  const key = typeof body.idempotencyKey === 'string' && /^[\w-]{8,64}$/.test(body.idempotencyKey) ? body.idempotencyKey : null;
  if (!key) throw new HttpError(400, 'Eksik işlem anahtarı.');
  return tx(() => {
    const l = findListing(params.id);
    if (l.user_id !== user.id) throw new HttpError(403, 'Bu ilan size ait değil.');
    if (l.status !== 'approved') throw new HttpError(409, 'Yalnızca yayındaki ilanlar öne çıkarılabilir.');
    const ref = `feature:${l.id}:${key}`;
    if (db.prepare('SELECT 1 FROM credit_ledger WHERE ref = ?').get(ref))
      return { listing: shapeListing(findListing(l.id), { full: true }), balance: balanceOf(user.id) };
    if (balanceOf(user.id) < COSTS.feature)
      throw new HttpError(402, `Öne çıkarmak için ${COSTS.feature} kredi gerekiyor.`);
    db.prepare(`UPDATE listings SET featured_until = datetime(MAX(COALESCE(featured_until, datetime('now')), datetime('now')), ?) WHERE id = ?`)
      .run(`+${FEATURE_DAYS} days`, l.id);
    db.prepare('INSERT INTO credit_ledger (user_id, amount, reason, ref) VALUES (?, ?, ?, ?)')
      .run(user.id, -COSTS.feature, `Vitrinde öne çıkarma #${l.id} (${FEATURE_DAYS} gün)`, ref);
    return { listing: shapeListing(findListing(l.id), { full: true }), balance: balanceOf(user.id) };
  });
}, { auth: true });

route('DELETE', '/api/listings/:id', ({ params, user }) => {
  const l = findListing(params.id);
  if (l.user_id !== user.id && user.role !== 'admin') throw new HttpError(403, 'Bu ilanı kaldırma yetkiniz yok.');
  db.prepare(`UPDATE listings SET status = 'removed' WHERE id = ?`).run(l.id);
  return { ok: true };
}, { auth: true });

/* ---------- hesabım ---------- */

route('GET', '/api/me/listings', ({ user }) => ({
  listings: db.prepare(`${LISTING_SQL} WHERE l.user_id = ? AND l.status <> 'removed' ORDER BY l.created_at DESC, l.id DESC`)
    .all(user.id).map(l => shapeListing(l, { full: true })),
}), { auth: true });

route('GET', '/api/me/ledger', ({ user }) => ({
  entries: db.prepare('SELECT id, amount, reason, created_at AS createdAt FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(user.id),
  balance: balanceOf(user.id),
}), { auth: true });

route('GET', '/api/me/reservations', ({ user }) => ({
  reservations: db.prepare(`SELECT id, topic, preferred_date AS date, status, created_at AS createdAt FROM reservations WHERE user_id = ? ORDER BY id DESC LIMIT 30`).all(user.id),
}), { auth: true });

/* ---------- kredi ve ödeme ---------- */

route('POST', '/api/credits/orders', ({ body, user }) => {
  const pkg = PACKAGES.find(p => p.id === body.packageId);
  if (!pkg) throw new HttpError(400, 'Geçersiz kredi paketi.');
  if (PAYMENT_MODE === 'none') throw new HttpError(503, 'Ödeme sağlayıcısı henüz yapılandırılmadı.');
  if (PAYMENT_MODE !== 'test') throw new HttpError(501, `${PAYMENT_MODE} entegrasyonu henüz uygulanmadı.`);
  const id = Number(db.prepare('INSERT INTO orders (user_id, package_id, credits, amount_kurus, provider) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, pkg.id, pkg.credits, pkg.price * 100, PAYMENT_MODE).lastInsertRowid);
  return { order: { id, packageId: pkg.id, name: pkg.name, credits: pkg.credits, price: pkg.price, status: 'pending' }, paymentMode: PAYMENT_MODE };
}, { auth: true, status: 201 });

// Yalnızca test modunda: gerçek sağlayıcıda bu adımın yerini imzası doğrulanan webhook alır.
route('POST', '/api/payments/test/:id/confirm', ({ params, user }) => {
  if (PAYMENT_MODE !== 'test') throw new HttpError(404, 'Bulunamadı.');
  return tx(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(params.id, user.id);
    if (!order) throw new HttpError(404, 'Sipariş bulunamadı.');
    if (order.status === 'cancelled') throw new HttpError(409, 'Bu sipariş iptal edilmiş.');
    if (order.status === 'pending') {
      db.prepare(`UPDATE orders SET status = 'paid', paid_at = CURRENT_TIMESTAMP, provider_ref = ? WHERE id = ?`).run(`test-${order.id}`, order.id);
      db.prepare('INSERT INTO credit_ledger (user_id, amount, reason, ref) VALUES (?, ?, ?, ?)')
        .run(user.id, order.credits, `Kredi yükleme · ${PACKAGES.find(p => p.id === order.package_id)?.name ?? order.package_id} paketi`, `order:${order.id}`);
    }
    return { ok: true, credits: order.credits, balance: balanceOf(user.id) };
  });
}, { auth: true });

route('POST', '/api/credits/orders/:id/cancel', ({ params, user }) => {
  db.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'pending'`).run(params.id, user.id);
  return { ok: true };
}, { auth: true });

/* ---------- rezervasyon / talep ---------- */

route('POST', '/api/reservations', ({ req, body, user }) => {
  rateLimit('reservation:' + clientIp(req), 10, 3600e3);
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  const listingId = Number(body.listingId) || null;
  if (listingId) findListing(listingId);
  db.prepare(`INSERT INTO reservations (user_id, listing_id, name, email, phone, topic, preferred_date, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    user?.id ?? null, listingId,
    text(body.name, 'Ad soyad', { min: 2, max: 80 }),
    email(body.email),
    text(body.phone, 'Telefon', { min: 0, max: 25 }),
    text(body.topic, 'Konu', { max: 120 }),
    date,
    text(body.message, 'Mesaj', { min: 5, max: 2000 }),
  );
  return { ok: true };
}, { status: 201 });

/* ---------- yönetim ---------- */

route('GET', '/api/admin/stats', () => {
  const one = (sql, ...a) => Object.values(db.prepare(sql).get(...a))[0] ?? 0;
  const days = db.prepare(`SELECT date(paid_at, '${TZ}') AS day, SUM(amount_kurus) AS kurus, COUNT(*) AS n FROM orders
    WHERE status = 'paid' AND date(paid_at, '${TZ}') >= date('now', '${TZ}', '-6 days') GROUP BY day`).all();
  const series = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() + 3 * 3600e3 - (6 - i) * 864e5).toISOString().slice(0, 10);
    const row = days.find(r => r.day === d);
    return { day: d, amount: (row?.kurus ?? 0) / 100, orders: row?.n ?? 0 };
  });
  return {
    todaySales: series[6].amount,
    todayOrders: series[6].orders,
    totalSales: one(`SELECT COALESCE(SUM(amount_kurus), 0) FROM orders WHERE status = 'paid'`) / 100,
    users: one('SELECT COUNT(*) FROM users'),
    usersToday: one(`SELECT COUNT(*) FROM users WHERE date(created_at, '${TZ}') = date('now', '${TZ}')`),
    pendingListings: one(`SELECT COUNT(*) FROM listings WHERE status = 'pending'`),
    liveListings: one(`SELECT COUNT(*) FROM listings WHERE status = 'approved'`),
    newReservations: one(`SELECT COUNT(*) FROM reservations WHERE status = 'new'`),
    creditsSpentToday: -one(`SELECT COALESCE(SUM(amount), 0) FROM credit_ledger WHERE amount < 0 AND ref NOT LIKE 'refund:%' AND date(created_at, '${TZ}') = date('now', '${TZ}')`),
    series,
    recentOrders: db.prepare(`SELECT o.id, o.credits, o.amount_kurus / 100.0 AS amount, o.status, o.provider, o.created_at AS createdAt, u.name, u.email
      FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.id DESC LIMIT 8`).all(),
  };
}, { admin: true });

route('GET', '/api/admin/listings', ({ query }) => {
  const status = query.get('status') || 'pending';
  const rows = status === 'all'
    ? db.prepare(`${LISTING_SQL} WHERE l.status <> 'removed' ORDER BY l.id DESC LIMIT 100`).all()
    : db.prepare(`${LISTING_SQL} WHERE l.status = ? ORDER BY l.id DESC LIMIT 100`).all(oneOf(status, ['pending', 'approved', 'rejected'], 'durum'));
  return { listings: rows.map(l => shapeListing(l, { full: true, admin: true })) };
}, { admin: true });

route('POST', '/api/admin/listings/:id/approve', ({ params }) => {
  const l = findListing(params.id);
  if (l.status !== 'pending') throw new HttpError(409, 'Bu ilan onay beklemiyor.');
  db.prepare(`UPDATE listings SET status = 'approved', reject_reason = NULL WHERE id = ?`).run(l.id);
  return { ok: true };
}, { admin: true });

// Reddedilen ilanın kredisi iade edilir; benzersiz ref ikinci iadeyi engeller.
route('POST', '/api/admin/listings/:id/reject', ({ params, body }) => {
  const reason = text(body.reason, 'Ret gerekçesi', { min: 3, max: 300 });
  return tx(() => {
    const l = findListing(params.id);
    if (l.status !== 'pending') throw new HttpError(409, 'Bu ilan onay beklemiyor.');
    db.prepare(`UPDATE listings SET status = 'rejected', reject_reason = ? WHERE id = ?`).run(reason, l.id);
    const charge = db.prepare('SELECT user_id, amount FROM credit_ledger WHERE ref = ?').get(`listing:${l.id}`);
    if (charge) db.prepare('INSERT OR IGNORE INTO credit_ledger (user_id, amount, reason, ref) VALUES (?, ?, ?, ?)')
      .run(charge.user_id, -charge.amount, `İlan iadesi #${l.id} (reddedildi)`, `refund:listing:${l.id}`);
    return { ok: true, refunded: charge ? -charge.amount : 0 };
  });
}, { admin: true });

route('GET', '/api/admin/reservations', () => ({
  reservations: db.prepare(`SELECT r.id, r.name, r.email, r.phone, r.topic, r.preferred_date AS date, r.message, r.status, r.created_at AS createdAt, r.listing_id AS listingId
    FROM reservations r ORDER BY r.id DESC LIMIT 100`).all(),
}), { admin: true });

route('POST', '/api/admin/reservations/:id/status', ({ params, body }) => {
  db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run(oneOf(body.status, ['new', 'confirmed', 'cancelled'], 'durum'), params.id);
  return { ok: true };
}, { admin: true });

route('GET', '/api/admin/users', () => ({
  users: db.prepare(`SELECT u.id, u.name, u.email, u.role, u.created_at AS createdAt,
    (SELECT COALESCE(SUM(amount), 0) FROM credit_ledger c WHERE c.user_id = u.id) AS balance,
    (SELECT COUNT(*) FROM listings l WHERE l.user_id = u.id AND l.status <> 'removed') AS listings
    FROM users u ORDER BY u.id DESC LIMIT 200`).all(),
}), { admin: true });

/* ---------- dağıtıcı ---------- */

export async function handleApi(req, res, url) {
  const send = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  try {
    const match = routes.map(r => ({ r, m: req.method === r.method && url.pathname.match(r.re) })).find(x => x.m);
    if (!match) throw new HttpError(404, 'Bulunamadı.');
    const { r, m } = match;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, Number(m[i + 1])]));
    const user = currentUser(req);
    if ((r.auth || r.admin) && !user) throw new HttpError(401, 'Bu işlem için giriş yapmalısınız.');
    if (r.admin && user.role !== 'admin') throw new HttpError(403, 'Bu alan yalnızca yöneticilere açık.');
    const body = req.method === 'GET' ? {} : await readBody(req, r.limit);
    const data = await r.handler({ req, res, params, body, user, query: url.searchParams });
    send(r.status, data);
  } catch (error) {
    if (error instanceof HttpError) return send(error.status, { error: error.message });
    console.error(error);
    send(500, { error: 'Beklenmeyen bir hata oluştu.' });
  }
}
