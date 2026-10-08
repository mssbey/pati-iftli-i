import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || join(import.meta.dirname, '..', 'data');
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'pati.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Kredi cüzdanı: bakiye her zaman bu defterin toplamıdır. ref benzersizdir;
-- aynı sipariş/ilan için ikinci kez kayıt düşülmesini engeller (idempotency).
CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id TEXT NOT NULL,
  credits INTEGER NOT NULL,
  amount_kurus INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY,
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
  featured_until TEXT,
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS listings_status ON listings(status, category);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL,
  preferred_date TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export const balanceOf = userId =>
  db.prepare('SELECT COALESCE(SUM(amount), 0) AS b FROM credit_ledger WHERE user_id = ?').get(userId).b;

const unsplash = id => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1100&q=80`;

// Tasarımı göstermek için örnek ilanlar. is_sample=1 olarak işaretlenir ve arayüzde "Örnek ilan" etiketiyle görünür.
const SAMPLES = [
  ['Yeni oyun arkadaşınız: Leo', 'adoption', 'dog', 'Golden Retriever', 'İstanbul', '3 aylık', 'Erkek', 'photo-1633722715463-d30f4f325e24', 1],
  ['Maya bir dost arıyor', 'mate', 'dog', 'Border Collie', 'Ankara', '2 yaşında', 'Dişi', 'photo-1551717743-49959800b1f6', 0],
  ['Minik Luna ile tanışın', 'adoption', 'cat', 'British Shorthair', 'İzmir', '5 aylık', 'Dişi', 'photo-1573865526739-10659fec78a5', 1],
  ['Bir avuç mutluluk: Teddy', 'adoption', 'dog', 'Pomeranian', 'İstanbul', '4 aylık', 'Erkek', 'photo-1587300003388-59208cc962cb', 0],
  ['Pamuk için yardımınızı bekliyoruz', 'lost', 'dog', 'Golden Retriever', 'Ankara', '3 yaşında', 'Dişi', 'photo-1558788353-f76d92427f16', 0],
  ['Yeni yuvalara mama paylaşımı', 'accessory', 'dog', 'Mama & aksesuar', 'İstanbul', 'Paylaşım', '—', 'photo-1548199973-03cce0bbc87b', 0],
  ['Enerjik dost Zeytin yuva arıyor', 'adoption', 'dog', 'Border Collie', 'İzmir', '1 yaşında', 'Erkek', 'photo-1583337130417-3346a1be7dee', 0],
  ['Duman için eş arayışı', 'mate', 'cat', 'British Shorthair', 'İstanbul', '3 yaşında', 'Erkek', 'photo-1573865526739-10659fec78a5', 0],
];

const SAMPLE_TEXT = {
  adoption: 'Bu örnek ilan, sahiplendirme ilanlarının nasıl görüneceğini göstermek için hazırlanmıştır. Gerçek bir ilanda; sağlık kayıtları, karakter özellikleri, aşı durumu ve sahiplendirme koşulları burada yer alır.',
  mate: 'Bu örnek ilan, eş bulma ilanlarının yapısını göstermek için hazırlanmıştır. Gerçek ilanlarda sağlık taramaları ve doğrulanmış soy bilgileri paylaşılmalıdır.',
  lost: 'Bu örnek ilan, kayıp dost ilanlarının yapısını göstermek için hazırlanmıştır. Gerçek ilanlarda son görüldüğü yer, ayırt edici özellikler ve iletişim tercihi paylaşılır.',
  accessory: 'Bu örnek ilan, mama ve aksesuar paylaşım ilanlarının yapısını göstermek için hazırlanmıştır.',
};

if (!db.prepare('SELECT 1 FROM listings LIMIT 1').get()) {
  const insert = db.prepare(`INSERT INTO listings (title, category, animal, breed, city, age, sex, description, photo, status, is_sample, featured_until)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 1, CASE WHEN ? THEN datetime('now', '+3650 days') END)`);
  tx(() => {
    for (const [title, category, animal, breed, city, age, sex, photo, featured] of SAMPLES)
      insert.run(title, category, animal, breed, city, age, sex, SAMPLE_TEXT[category], unsplash(photo), featured);
  });
}
