import { randomBytes } from 'node:crypto';
import { query, one, tx, balanceOf, ready, DEMO, DATABASE_URL_KEY } from './db.js';
import { storeImage, deleteImage, storageReady } from './storage.js';
import { hashPassword, verifyPassword, newToken, sha256 } from './security.js';

const PROD = process.env.NODE_ENV === 'production';
const SECURE_COOKIE = PROD || process.env.COOKIE_SECURE === '1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || Boolean(process.env.VERCEL);
// 'test': tahsilatsız test ödemesi. 'none': ödeme kapalı (production varsayılanı).
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
// Türkiye saati (UTC+3) ile günlük raporlar
const TR_DAY = col => `((${col} AT TIME ZONE 'UTC') + interval '3 hours')::date`;
const CATEGORIES = ['adoption', 'mate', 'lost', 'accessory'];
const ANIMALS = ['dog', 'cat', 'other'];
const DEMO_TOPUP = 50;
let dummyHash;

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
  routes.push({ method, re, keys, handler, auth: false, admin: false, db: true, limit: 64 * 1024, status: 200, ...opts });
}

function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return req.headers['x-forwarded-for'].split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// Bellek içi sınır; sunucusuz ortamda örnek başına çalışır.
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

async function currentUser(req) {
  const token = sessionToken(req);
  if (!token) return null;
  return (await one(`SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha256(token)])) || null;
}

async function startSession(res, userId) {
  const token = newToken();
  await query('DELETE FROM sessions WHERE expires_at < now()');
  await query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
    [sha256(token), userId, SESSION_DAYS]);
  res.setHeader('Set-Cookie', cookie(token, SESSION_DAYS * 86400));
}

const cookie = (value, maxAge) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE_COOKIE ? '; Secure' : ''}`;

async function account(userId) {
  const user = await one('SELECT id, name, email, role, created_at AS "createdAt" FROM users WHERE id = $1', [userId]);
  return { user, balance: await balanceOf(userId) };
}

// Kredi düşen işlemlerde kullanıcının satırı kilitlenir; eşzamanlı istekler bakiyeyi aşamaz.
const lockUser = (q, userId) => q('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

const shortName = name => {
  const [first, ...rest] = String(name || 'Üye').split(/\s+/);
  return rest.length ? `${first} ${rest.at(-1)[0]}.` : first;
};

const LISTING_SQL = `SELECT l.*, u.name AS owner_name, u.email AS owner_email,
  (l.featured_until IS NOT NULL AND l.featured_until > now()) AS featured
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
  { ext: 'jpg', type: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', type: 'image/png', test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', type: 'image/webp', test: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

// Fotoğraf data URL olarak gelir; tür, bildirilen MIME'a değil dosyanın ilk baytlarına göre doğrulanır.
async function savePhoto(dataUrl) {
  if (dataUrl == null || dataUrl === '') return null;
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new HttpError(400, 'Fotoğraf JPG, PNG veya WEBP olmalı.');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length > 3 * 1024 * 1024) throw new HttpError(413, 'Fotoğraf en fazla 3 MB olabilir.');
  const kind = IMAGE_TYPES.find(t => t.test(bytes));
  if (!kind) throw new HttpError(400, 'Fotoğraf dosyası tanınamadı.');
  if (!storageReady()) throw new HttpError(503, 'Fotoğraf depolama henüz yapılandırılmadı. İlanı fotoğrafsız gönderebilirsiniz.');
  return storeImage(bytes, kind.ext, kind.type);
}

async function findListing(id, q = query) {
  const l = (await q(`${LISTING_SQL} WHERE l.id = $1`, [id]))[0];
  if (!l || l.status === 'removed') throw new HttpError(404, 'İlan bulunamadı.');
  return l;
}

const addLedger = (q, userId, amount, reason, ref) =>
  q('INSERT INTO credit_ledger (user_id, amount, reason, ref) VALUES ($1, $2, $3, $4)', [userId, amount, reason, ref]);

/* ---------- genel ---------- */

route('GET', '/api/config', () => ({
  packages: PACKAGES, costs: COSTS, featureDays: FEATURE_DAYS, paymentMode: PAYMENT_MODE,
  demo: DEMO && { email: DEMO.email, password: DEMO.password },
}), { db: false });

// Yayın teşhisi: gizli bilgi döndürmez, yalnızca hangi parçanın eksik olduğunu söyler.
route('GET', '/api/health', async () => {
  const health = {
    database: 'ok',
    databaseUrl: DATABASE_URL_KEY || 'tanımlı değil',
    photoStorage: storageReady() ? 'ok' : 'BLOB_READ_WRITE_TOKEN eksik',
    paymentMode: PAYMENT_MODE,
    adminFromEnv: Boolean(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD),
    demoAccount: Boolean(DEMO),
  };
  try {
    await ready();
  } catch (error) {
    health.database = dbErrorMessage(error);
  }
  return health;
}, { db: false });

route('GET', '/api/stats', async () => {
  const rows = await query(`SELECT category, COUNT(*)::int AS n FROM listings WHERE status = 'approved' GROUP BY category`);
  const counts = Object.fromEntries(CATEGORIES.map(c => [c, 0]));
  for (const r of rows) counts[r.category] = r.n;
  const { n: cities } = await one(`SELECT COUNT(DISTINCT city)::int AS n FROM listings WHERE status = 'approved'`);
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
  const row = await one(`INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id`, [mail, name, hash]);
  if (!row) throw new HttpError(409, 'Bu e-posta ile kayıtlı bir hesap zaten var.');
  await startSession(res, row.id);
  return account(row.id);
}, { status: 201 });

route('POST', '/api/auth/login', async ({ req, res, body }) => {
  rateLimit('login:' + clientIp(req), 10, 15 * 60e3);
  const mail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const user = await one('SELECT id, password_hash FROM users WHERE email = $1', [mail]);
  dummyHash ??= await hashPassword(randomBytes(12).toString('hex'));
  const ok = await verifyPassword(password, user?.password_hash ?? dummyHash);
  if (!user || !ok) throw new HttpError(401, 'E-posta veya şifre hatalı.');
  // Demo hesabın kredisi bitmesin: bakiye 10 kredinin altına düştüyse girişte 50 krediye tamamlanır.
  if (DEMO && mail === DEMO.email) {
    const balance = await balanceOf(user.id);
    if (balance < COSTS.feature)
      await addLedger(query, user.id, DEMO_TOPUP - balance, 'Demo hesap kredi yüklemesi', `demo-topup:${Date.now()}:${randomBytes(4).toString('hex')}`);
  }
  await startSession(res, user.id);
  return account(user.id);
});

route('POST', '/api/auth/logout', async ({ req, res }) => {
  const token = sessionToken(req);
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  res.setHeader('Set-Cookie', cookie('', 0));
  return { ok: true };
});

route('GET', '/api/auth/me', ({ user }) => (user ? account(user.id) : { user: null, balance: 0 }), { db: 'session' });

/* ---------- ilanlar ---------- */

route('GET', '/api/listings', async ({ query: qs }) => {
  const where = [`l.status = 'approved'`];
  const args = [];
  const arg = v => (args.push(v), `$${args.length}`);
  for (const key of ['category', 'animal', 'breed', 'city']) {
    const v = qs.get(key);
    if (v && v !== 'all') where.push(`l.${key} = ${arg(v)}`);
  }
  const q = (qs.get('q') || '').trim().slice(0, 60).replace(/[%_\\]/g, '');
  if (q) {
    const p = arg(`%${q}%`);
    where.push(`(l.title ILIKE ${p} OR l.breed ILIKE ${p} OR l.city ILIKE ${p} OR l.description ILIKE ${p})`);
  }
  if (qs.get('featured') === '1') where.push('l.featured_until > now()');
  const exclude = Number(qs.get('exclude'));
  if (exclude) where.push(`l.id <> ${arg(exclude)}`);
  const limit = Math.min(Math.max(Number(qs.get('limit')) || 48, 1), 100);
  const rows = await query(`${LISTING_SQL} WHERE ${where.join(' AND ')} ORDER BY featured DESC, l.created_at DESC, l.id DESC LIMIT ${arg(limit)}`, args);
  return { listings: rows.map(l => shapeListing(l)) };
});

route('GET', '/api/listings/facets', async () => ({
  breeds: (await query(`SELECT DISTINCT breed FROM listings WHERE status = 'approved' ORDER BY breed`)).map(r => r.breed),
  cities: (await query(`SELECT DISTINCT city FROM listings WHERE status = 'approved' ORDER BY city`)).map(r => r.city),
}));

route('GET', '/api/listings/:id', async ({ params, user }) => {
  const l = await findListing(params.id);
  const canSee = l.status === 'approved' || (user && (user.id === l.user_id || user.role === 'admin'));
  if (!canSee) throw new HttpError(404, 'İlan bulunamadı.');
  return { listing: shapeListing(l, { full: true }), mine: !!user && user.id === l.user_id };
});

route('POST', '/api/listings', async ({ body, user }) => {
  const fields = [
    text(body.title, 'İlan başlığı', { min: 5, max: 90 }),
    oneOf(body.category, CATEGORIES, 'kategori'),
    oneOf(body.animal, ANIMALS, 'tür'),
    text(body.breed, 'Irk', { max: 50 }),
    text(body.city, 'Şehir', { max: 40 }),
    text(body.age, 'Yaş', { min: 0, max: 30 }),
    text(body.sex, 'Cinsiyet', { min: 0, max: 20 }),
    text(body.description, 'Açıklama', { min: 20, max: 3000 }),
  ];
  if (await balanceOf(user.id) < COSTS.listing)
    throw new HttpError(402, `İlan vermek için ${COSTS.listing} kredi gerekiyor. Kredi yükleyerek devam edebilirsiniz.`);
  const photo = await savePhoto(body.photo);
  try {
    return await tx(async q => {
      await lockUser(q, user.id);
      if (await balanceOf(user.id, q) < COSTS.listing)
        throw new HttpError(402, `İlan vermek için ${COSTS.listing} kredi gerekiyor. Kredi yükleyerek devam edebilirsiniz.`);
      const [{ id }] = await q(`INSERT INTO listings (user_id, title, category, animal, breed, city, age, sex, description, photo)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`, [user.id, ...fields, photo]);
      await addLedger(q, user.id, -COSTS.listing, `İlan oluşturma #${id}`, `listing:${id}`);
      return { listing: shapeListing(await findListing(id, q), { full: true }), balance: await balanceOf(user.id, q) };
    });
  } catch (error) {
    await deleteImage(photo);
    throw error;
  }
}, { auth: true, limit: 4 * 1024 * 1024, status: 201 });

route('POST', '/api/listings/:id/feature', async ({ params, body, user }) => {
  const key = typeof body.idempotencyKey === 'string' && /^[\w-]{8,64}$/.test(body.idempotencyKey) ? body.idempotencyKey : null;
  if (!key) throw new HttpError(400, 'Eksik işlem anahtarı.');
  return tx(async q => {
    await lockUser(q, user.id);
    const l = await findListing(params.id, q);
    if (l.user_id !== user.id) throw new HttpError(403, 'Bu ilan size ait değil.');
    if (l.status !== 'approved') throw new HttpError(409, 'Yalnızca yayındaki ilanlar öne çıkarılabilir.');
    const ref = `feature:${l.id}:${key}`;
    if (!(await q('SELECT 1 FROM credit_ledger WHERE ref = $1', [ref])).length) {
      if (await balanceOf(user.id, q) < COSTS.feature)
        throw new HttpError(402, `Öne çıkarmak için ${COSTS.feature} kredi gerekiyor.`);
      await q(`UPDATE listings SET featured_until = GREATEST(COALESCE(featured_until, now()), now()) + make_interval(days => $1) WHERE id = $2`,
        [FEATURE_DAYS, l.id]);
      await addLedger(q, user.id, -COSTS.feature, `Vitrinde öne çıkarma #${l.id} (${FEATURE_DAYS} gün)`, ref);
    }
    return { listing: shapeListing(await findListing(l.id, q), { full: true }), balance: await balanceOf(user.id, q) };
  });
}, { auth: true });

route('DELETE', '/api/listings/:id', async ({ params, user }) => {
  const l = await findListing(params.id);
  if (l.user_id !== user.id && user.role !== 'admin') throw new HttpError(403, 'Bu ilanı kaldırma yetkiniz yok.');
  await query(`UPDATE listings SET status = 'removed' WHERE id = $1`, [l.id]);
  return { ok: true };
}, { auth: true });

/* ---------- hesabım ---------- */

route('GET', '/api/me/listings', async ({ user }) => ({
  listings: (await query(`${LISTING_SQL} WHERE l.user_id = $1 AND l.status <> 'removed' ORDER BY l.created_at DESC, l.id DESC`, [user.id]))
    .map(l => shapeListing(l, { full: true })),
}), { auth: true });

route('GET', '/api/me/ledger', async ({ user }) => ({
  entries: await query('SELECT id, amount, reason, created_at AS "createdAt" FROM credit_ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 50', [user.id]),
  balance: await balanceOf(user.id),
}), { auth: true });

route('GET', '/api/me/reservations', async ({ user }) => ({
  reservations: await query(`SELECT id, topic, to_char(preferred_date, 'YYYY-MM-DD') AS date, status, created_at AS "createdAt" FROM reservations WHERE user_id = $1 ORDER BY id DESC LIMIT 30`, [user.id]),
}), { auth: true });

/* ---------- kredi ve ödeme ---------- */

route('POST', '/api/credits/orders', async ({ body, user }) => {
  const pkg = PACKAGES.find(p => p.id === body.packageId);
  if (!pkg) throw new HttpError(400, 'Geçersiz kredi paketi.');
  if (PAYMENT_MODE === 'none') throw new HttpError(503, 'Ödeme sağlayıcısı henüz yapılandırılmadı.');
  if (PAYMENT_MODE !== 'test') throw new HttpError(501, `${PAYMENT_MODE} entegrasyonu henüz uygulanmadı.`);
  const { id } = await one('INSERT INTO orders (user_id, package_id, credits, amount_kurus, provider) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [user.id, pkg.id, pkg.credits, pkg.price * 100, PAYMENT_MODE]);
  return { order: { id, packageId: pkg.id, name: pkg.name, credits: pkg.credits, price: pkg.price, status: 'pending' }, paymentMode: PAYMENT_MODE };
}, { auth: true, status: 201 });

// Yalnızca test modunda: gerçek sağlayıcıda bu adımın yerini imzası doğrulanan webhook alır.
route('POST', '/api/payments/test/:id/confirm', async ({ params, user }) => {
  if (PAYMENT_MODE !== 'test') throw new HttpError(404, 'Bulunamadı.');
  return tx(async q => {
    const [order] = await q('SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE', [params.id, user.id]);
    if (!order) throw new HttpError(404, 'Sipariş bulunamadı.');
    if (order.status === 'cancelled') throw new HttpError(409, 'Bu sipariş iptal edilmiş.');
    if (order.status === 'pending') {
      await q(`UPDATE orders SET status = 'paid', paid_at = now(), provider_ref = $1 WHERE id = $2`, [`test-${order.id}`, order.id]);
      await addLedger(q, user.id, order.credits, `Kredi yükleme · ${PACKAGES.find(p => p.id === order.package_id)?.name ?? order.package_id} paketi`, `order:${order.id}`);
    }
    return { ok: true, credits: order.credits, balance: await balanceOf(user.id, q) };
  });
}, { auth: true });

route('POST', '/api/credits/orders/:id/cancel', async ({ params, user }) => {
  await query(`UPDATE orders SET status = 'cancelled' WHERE id = $1 AND user_id = $2 AND status = 'pending'`, [params.id, user.id]);
  return { ok: true };
}, { auth: true });

/* ---------- rezervasyon / talep ---------- */

route('POST', '/api/reservations', async ({ req, body, user }) => {
  rateLimit('reservation:' + clientIp(req), 10, 3600e3);
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  const listingId = Number(body.listingId) || null;
  if (listingId) await findListing(listingId);
  await query(`INSERT INTO reservations (user_id, listing_id, name, email, phone, topic, preferred_date, message) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
    user?.id ?? null, listingId,
    text(body.name, 'Ad soyad', { min: 2, max: 80 }),
    email(body.email),
    text(body.phone, 'Telefon', { min: 0, max: 25 }),
    text(body.topic, 'Konu', { max: 120 }),
    date,
    text(body.message, 'Mesaj', { min: 5, max: 2000 }),
  ]);
  return { ok: true };
}, { status: 201 });

/* ---------- yönetim ---------- */

route('GET', '/api/admin/stats', async () => {
  const today = `((now() AT TIME ZONE 'UTC') + interval '3 hours')::date`;
  const val = async sql => Object.values(await one(sql))[0] ?? 0;
  const days = await query(`SELECT to_char(${TR_DAY('paid_at')}, 'YYYY-MM-DD') AS day, SUM(amount_kurus)::int AS kurus, COUNT(*)::int AS n FROM orders
    WHERE status = 'paid' AND ${TR_DAY('paid_at')} >= ${today} - 6 GROUP BY 1`);
  const series = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() + 3 * 3600e3 - (6 - i) * 864e5).toISOString().slice(0, 10);
    const row = days.find(r => r.day === d);
    return { day: d, amount: (row?.kurus ?? 0) / 100, orders: row?.n ?? 0 };
  });
  return {
    todaySales: series[6].amount,
    todayOrders: series[6].orders,
    totalSales: (await val(`SELECT COALESCE(SUM(amount_kurus), 0)::int FROM orders WHERE status = 'paid'`)) / 100,
    users: await val('SELECT COUNT(*)::int FROM users'),
    usersToday: await val(`SELECT COUNT(*)::int FROM users WHERE ${TR_DAY('created_at')} = ${today}`),
    pendingListings: await val(`SELECT COUNT(*)::int FROM listings WHERE status = 'pending'`),
    liveListings: await val(`SELECT COUNT(*)::int FROM listings WHERE status = 'approved'`),
    newReservations: await val(`SELECT COUNT(*)::int FROM reservations WHERE status = 'new'`),
    creditsSpentToday: -(await val(`SELECT COALESCE(SUM(amount), 0)::int FROM credit_ledger WHERE amount < 0 AND ref NOT LIKE 'refund:%' AND ${TR_DAY('created_at')} = ${today}`)),
    series,
    recentOrders: await query(`SELECT o.id, o.credits, (o.amount_kurus / 100.0)::float8 AS amount, o.status, o.provider, o.created_at AS "createdAt", u.name, u.email
      FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.id DESC LIMIT 8`),
  };
}, { admin: true });

route('GET', '/api/admin/listings', async ({ query: qs }) => {
  const status = qs.get('status') || 'pending';
  const rows = status === 'all'
    ? await query(`${LISTING_SQL} WHERE l.status <> 'removed' ORDER BY l.id DESC LIMIT 100`)
    : await query(`${LISTING_SQL} WHERE l.status = $1 ORDER BY l.id DESC LIMIT 100`, [oneOf(status, ['pending', 'approved', 'rejected'], 'durum')]);
  return { listings: rows.map(l => shapeListing(l, { full: true, admin: true })) };
}, { admin: true });

route('POST', '/api/admin/listings/:id/approve', async ({ params }) => {
  const [row] = await query(`UPDATE listings SET status = 'approved', reject_reason = NULL WHERE id = $1 AND status = 'pending' RETURNING id`, [params.id]);
  if (!row) throw new HttpError(409, 'Bu ilan onay beklemiyor.');
  return { ok: true };
}, { admin: true });

// Reddedilen ilanın kredisi iade edilir; benzersiz ref ikinci iadeyi engeller.
route('POST', '/api/admin/listings/:id/reject', async ({ params, body }) => {
  const reason = text(body.reason, 'Ret gerekçesi', { min: 3, max: 300 });
  return tx(async q => {
    const [row] = await q(`UPDATE listings SET status = 'rejected', reject_reason = $1 WHERE id = $2 AND status = 'pending' RETURNING id`, [reason, params.id]);
    if (!row) throw new HttpError(409, 'Bu ilan onay beklemiyor.');
    const [charge] = await q('SELECT user_id, amount FROM credit_ledger WHERE ref = $1', [`listing:${row.id}`]);
    if (charge) await q('INSERT INTO credit_ledger (user_id, amount, reason, ref) VALUES ($1, $2, $3, $4) ON CONFLICT (ref) DO NOTHING',
      [charge.user_id, -charge.amount, `İlan iadesi #${row.id} (reddedildi)`, `refund:listing:${row.id}`]);
    return { ok: true, refunded: charge ? -charge.amount : 0 };
  });
}, { admin: true });

route('GET', '/api/admin/reservations', async () => ({
  reservations: await query(`SELECT id, name, email, phone, topic, to_char(preferred_date, 'YYYY-MM-DD') AS date, message, status, created_at AS "createdAt", listing_id AS "listingId"
    FROM reservations ORDER BY id DESC LIMIT 100`),
}), { admin: true });

route('POST', '/api/admin/reservations/:id/status', async ({ params, body }) => {
  await query('UPDATE reservations SET status = $1 WHERE id = $2', [oneOf(body.status, ['new', 'confirmed', 'cancelled'], 'durum'), params.id]);
  return { ok: true };
}, { admin: true });

route('GET', '/api/admin/users', async () => ({
  users: await query(`SELECT u.id, u.name, u.email, u.role, u.created_at AS "createdAt",
    (SELECT COALESCE(SUM(amount), 0)::int FROM credit_ledger c WHERE c.user_id = u.id) AS balance,
    (SELECT COUNT(*)::int FROM listings l WHERE l.user_id = u.id AND l.status <> 'removed') AS listings
    FROM users u ORDER BY u.id DESC LIMIT 200`),
}), { admin: true });

/* ---------- dağıtıcı ---------- */

function dbErrorMessage(error) {
  const reason = String(error?.message || error).replace(/postgres(ql)?:\/\/\S+/gi, '[bağlantı adresi]').slice(0, 200);
  return `Veritabanına bağlanılamadı: ${reason}`;
}

export async function handleApi(req, res, url) {
  const send = (status, data) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(data));
  };
  try {
    const match = routes.map(r => ({ r, m: req.method === r.method && url.pathname.match(r.re) })).find(x => x.m);
    if (!match) throw new HttpError(404, 'Bulunamadı.');
    const { r, m } = match;
    // Oturumsuz ziyaretçinin /me isteği veritabanı gerektirmez; ana sayfa DB sorunu olsa da açılır.
    const needsDb = r.db === true || (r.db === 'session' && sessionToken(req));
    if (needsDb) {
      try {
        await ready();
      } catch (error) {
        console.error(error);
        throw new HttpError(503, dbErrorMessage(error));
      }
    }
    const params = Object.fromEntries(r.keys.map((k, i) => [k, Number(m[i + 1])]));
    const user = needsDb ? await currentUser(req) : null;
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
