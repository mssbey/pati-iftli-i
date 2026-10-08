import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { hashPassword } from './security.js';

// Yayında DATABASE_URL (Neon / Vercel Postgres) kullanılır. Tanımlı değilse yerelde
// data/pg klasöründe gömülü Postgres (PGlite) açılır; iki ortamda da SQL aynıdır.
// Vercel bağlarken değişkene önek ekleyebilir (ör. STORAGE_DATABASE_URL); bunlar da kabul edilir.
const URL_KEYS = ['DATABASE_URL', 'POSTGRES_URL'];
export const DATABASE_URL_KEY = URL_KEYS.find(k => process.env[k]) ||
  Object.keys(process.env).sort().find(k => /_(DATABASE_URL|POSTGRES_URL)$/.test(k) && /^postgres(ql)?:\/\//.test(process.env[k])) || null;
const DATABASE_URL = DATABASE_URL_KEY && process.env[DATABASE_URL_KEY];
export const EPHEMERAL = !DATABASE_URL && Boolean(process.env.VERCEL);
const PROD = process.env.NODE_ENV === 'production';
export const DATA_DIR = process.env.DATA_DIR || join(import.meta.dirname, '..', 'data');
// Giriş ekranında gösterilen herkese açık demo üye. Gerçek yayından önce DEMO_ACCOUNT=0 ile kapatın.
export const DEMO = process.env.DEMO_ACCOUNT === '0' ? null : { email: 'uye@pati.local', password: 'Uye12345', name: 'Demo Üye' };

let driver;
async function getDriver() {
  if (driver) return driver;
  if (DATABASE_URL) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
    driver = {
      exec: sql => pool.query(sql),
      query: async (sql, params) => (await pool.query(sql, params)).rows,
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(async (sql, params) => (await client.query(sql, params)).rows);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        } finally {
          client.release();
        }
      },
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    let db;
    if (EPHEMERAL) {
      // Vercel'de veritabanı bağlanana kadar: bellek içi Postgres. Örnek uykuya geçince veriler sıfırlanır.
      console.warn('DATABASE_URL yok: geçici bellek içi veritabanı kullanılıyor (veriler kalıcı değil).');
      db = new PGlite();
    } else {
      await mkdir(DATA_DIR, { recursive: true });
      db = new PGlite(join(DATA_DIR, 'pg'));
    }
    driver = {
      exec: sql => db.exec(sql),
      query: async (sql, params) => (await db.query(sql, params)).rows,
      tx: fn => db.transaction(t => fn(async (sql, params) => (await t.query(sql, params)).rows)),
    };
  }
  return driver;
}

export const query = async (sql, params = []) => (await getDriver()).query(sql, params);
export const one = async (sql, params) => (await query(sql, params))[0];
export const tx = async fn => (await getDriver()).tx(fn);

export const balanceOf = async (userId, q = query) =>
  (await q('SELECT COALESCE(SUM(amount), 0)::int AS b FROM credit_ledger WHERE user_id = $1', [userId]))[0].b;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Kredi cüzdanı: bakiye her zaman bu defterin toplamıdır. ref benzersizdir,
-- aynı sipariş/ilan için ikinci kez kayıt düşülmesini engeller (idempotency).
CREATE TABLE IF NOT EXISTS credit_ledger (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_ledger_user ON credit_ledger(user_id);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id TEXT NOT NULL,
  credits INTEGER NOT NULL,
  amount_kurus INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS listings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  animal TEXT NOT NULL,
  breed TEXT NOT NULL,
  city TEXT NOT NULL,
  age TEXT NOT NULL DEFAULT '',
  sex TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  photo TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
  reject_reason TEXT,
  featured_until TIMESTAMPTZ,
  is_sample BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listings_status ON listings(status, category);

CREATE TABLE IF NOT EXISTS reservations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL,
  preferred_date DATE,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const unsplash = id => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1100&q=80`;

// Tasarımı göstermek için örnek ilanlar. is_sample=true olarak işaretlenir ve arayüzde "Örnek ilan" etiketiyle görünür.
const SAMPLES = [
  ['Yeni oyun arkadaşınız: Leo', 'adoption', 'dog', 'Golden Retriever', 'İstanbul', '3 aylık', 'Erkek', 'photo-1633722715463-d30f4f325e24', true],
  ['Maya bir dost arıyor', 'mate', 'dog', 'Border Collie', 'Ankara', '2 yaşında', 'Dişi', 'photo-1551717743-49959800b1f6', false],
  ['Minik Luna ile tanışın', 'adoption', 'cat', 'British Shorthair', 'İzmir', '5 aylık', 'Dişi', 'photo-1573865526739-10659fec78a5', true],
  ['Bir avuç mutluluk: Teddy', 'adoption', 'dog', 'Pomeranian', 'İstanbul', '4 aylık', 'Erkek', 'photo-1587300003388-59208cc962cb', false],
  ['Pamuk için yardımınızı bekliyoruz', 'lost', 'dog', 'Golden Retriever', 'Ankara', '3 yaşında', 'Dişi', 'photo-1558788353-f76d92427f16', false],
  ['Yeni yuvalara mama paylaşımı', 'accessory', 'dog', 'Mama & aksesuar', 'İstanbul', 'Paylaşım', '—', 'photo-1548199973-03cce0bbc87b', false],
  ['Enerjik dost Zeytin yuva arıyor', 'adoption', 'dog', 'Border Collie', 'İzmir', '1 yaşında', 'Erkek', 'photo-1583337130417-3346a1be7dee', false],
  ['Duman için eş arayışı', 'mate', 'cat', 'British Shorthair', 'İstanbul', '3 yaşında', 'Erkek', 'photo-1573865526739-10659fec78a5', false],
];

const SAMPLE_TEXT = {
  adoption: 'Bu örnek ilan, sahiplendirme ilanlarının nasıl görüneceğini göstermek için hazırlanmıştır. Gerçek bir ilanda; sağlık kayıtları, karakter özellikleri, aşı durumu ve sahiplendirme koşulları burada yer alır.',
  mate: 'Bu örnek ilan, eş bulma ilanlarının yapısını göstermek için hazırlanmıştır. Gerçek ilanlarda sağlık taramaları ve doğrulanmış soy bilgileri paylaşılmalıdır.',
  lost: 'Bu örnek ilan, kayıp dost ilanlarının yapısını göstermek için hazırlanmıştır. Gerçek ilanlarda son görüldüğü yer, ayırt edici özellikler ve iletişim tercihi paylaşılır.',
  accessory: 'Bu örnek ilan, mama ve aksesuar paylaşım ilanlarının yapısını göstermek için hazırlanmıştır.',
};

async function init() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = 'Çiftlik Yöneticisi' } = process.env;
  const adminHash = ADMIN_EMAIL && ADMIN_PASSWORD ? await hashPassword(ADMIN_PASSWORD) : null;
  const demoHash = DEMO ? await hashPassword(DEMO.password) : null;
  let devPassword = null;
  // Birden çok sunucusuz örnek aynı anda açılırsa kurulumun tek seferde yapılması için kilit.
  await tx(async q => {
    await q('SELECT pg_advisory_xact_lock(424242)');
    for (const statement of SCHEMA.split(';').map(s => s.trim()).filter(Boolean)) await q(statement);
    if (!(await q('SELECT 1 FROM listings LIMIT 1')).length) {
      for (const [title, category, animal, breed, city, age, sex, photo, featured] of SAMPLES)
        await q(`INSERT INTO listings (title, category, animal, breed, city, age, sex, description, photo, status, is_sample, featured_until)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved', true, CASE WHEN $10::boolean THEN now() + interval '3650 days' END)`,
        [title, category, animal, breed, city, age, sex, SAMPLE_TEXT[category], unsplash(photo), featured]);
    }
    if (demoHash) {
      await q(`INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
        ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'user'`, [DEMO.email, DEMO.name, demoHash]);
    }
    if (adminHash) {
      await q(`INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, 'admin')
        ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'`,
      [ADMIN_EMAIL.trim().toLowerCase(), ADMIN_NAME, adminHash]);
    } else if (!PROD && !(await q(`SELECT 1 FROM users WHERE role = 'admin'`)).length) {
      devPassword = randomBytes(9).toString('base64url');
      await q(`INSERT INTO users (email, name, password_hash, role) VALUES ('admin@pati.local', $1, $2, 'admin') ON CONFLICT (email) DO NOTHING`,
        [ADMIN_NAME, await hashPassword(devPassword)]);
    }
  });
  if (devPassword) {
    console.log(`\n  Geliştirme yöneticisi oluşturuldu → admin@pati.local / ${devPassword}`);
    console.log('  (Kalıcı yönetici için .env dosyasına ADMIN_EMAIL ve ADMIN_PASSWORD ekleyin.)\n');
  }
}

let readyPromise;
export function ready() {
  readyPromise ??= init().catch(error => {
    readyPromise = null;
    throw error;
  });
  return readyPromise;
}
