# Pati Çiftliği

Türkçe, mobil uyumlu köpek çiftliği ve ilan platformu: üyelik, kredi cüzdanı, ilan verme / öne çıkarma, yönetici onayı, rezervasyon talepleri ve yönetim paneli.

## Çalıştırma

Gereksinim: **Node.js 22+**.

```powershell
npm install
npm start
```

Tarayıcıda http://localhost:3000 adresini açın. İlk açılışta yönetici hesabı yoksa terminale `admin@pati.local` için tek seferlik bir şifre yazdırılır. Kalıcı yönetici için `.env.example` dosyasını `.env` olarak kopyalayıp `ADMIN_EMAIL` ve `ADMIN_PASSWORD` girin (her açılışta bu hesap yönetici yapılır ve şifresi güncellenir).

Giriş ekranında herkese açık bir **demo hesap** (`uye@pati.local` / `Uye12345`) gösterilir; sunucu bu hesabı kendisi oluşturur ve kredisi 10'un altına düşünce girişte 50'ye tamamlar. Gerçek yayından önce `DEMO_ACCOUNT=0` ile kapatın.

Geliştirirken `npm run dev` sunucuyu dosya değişikliklerinde yeniden başlatır. Sözdizimi kontrolü: `npm run check`.

## Yapı

- `server/index.js` — yerel geliştirme sunucusu: statik dosyalar (`dist/`), yüklenen fotoğraflar, API.
- `api/index.js` — Vercel sunucusuz fonksiyonu; tüm `/api/*` isteklerini `server/api.js`'e iletir.
- `vercel.json` — Vercel ayarları ve güvenlik başlıkları (CSP vb.; yerel sunucu da buradan okur).
- `server/api.js` — JSON API: üyelik/oturum, ilanlar, kredi defteri, siparişler, rezervasyonlar, yönetim.
- `server/db.js` — Postgres şeması, örnek ilanlar ve yönetici kurulumu. `DATABASE_URL` varsa ona bağlanır; yoksa yerelde gömülü Postgres (PGlite) ile `data/pg` klasörünü kullanır (git dışı).
- `server/storage.js` — fotoğraflar: `BLOB_READ_WRITE_TOKEN` varsa Vercel Blob, yoksa `data/uploads`.
- `dist/index.html`, `dist/styles.css`, `dist/app.js` — derleme gerektirmeyen ön yüz (hash tabanlı sayfalar: `#/giris`, `#/kayit`, `#/krediler`, `#/ilan-ver`, `#/ilan/:id`, `#/hesabim`, `#/yonetim`).

## Nasıl çalışır

- **Oturum:** scrypt ile şifre hash'i, HttpOnly + SameSite=Lax çerez; giriş/kayıt hız sınırlı.
- **Krediler:** Bakiye, `credit_ledger` tablosunun toplamıdır. Her kaydın benzersiz `ref` değeri vardır; aynı sipariş ya da ilan için çift kayıt düşülemez. İlan (5 kredi) ve öne çıkarma (10 kredi / 7 gün) bakiye kontrolüyle tek işlemde (transaction) düşülür. Reddedilen ilanın kredisi otomatik iade edilir.
- **Kredi satın alma** yalnızca giriş yapmış kullanıcılara açıktır. Ödeme modu `PAYMENT_PROVIDER` ile belirlenir: `test` (geliştirme varsayılanı, tahsilat yok, kart bilgisi istenmez) veya `none` (production varsayılanı, satış kapalı).
- **Fotoğraflar:** Tarayıcıda 1400 px'e küçültülüp JPEG olarak yeniden kodlanır (EXIF/konum silinir); sunucu türü dosya imzasından doğrular, 3 MB sınırı uygular ve rastgele adla saklar.

## Henüz yapılmayanlar

- iyzico / PayTR entegrasyonu (sağlayıcı hesabı gerekir). Bağlandığında `POST /api/credits/orders` sağlayıcı ödeme formunu başlatmalı, kredi tanımlaması imzası doğrulanan webhook ile `order:<id>` ref'iyle yapılmalı (defter zaten idempotent).
- Üyeler arası mesajlaşma (şimdilik talepler yöneticiye düşüyor), e-posta doğrulama ve şifre sıfırlama.
- Gerçek çiftlik bilgileri, fotoğraflar, pedigree belgeleri, KVKK ve kullanım koşulları metinleri (proje sahibinden alınmalı).

## Vercel'e yayın

1. Vercel'de **Add New → Project** ile `mssbey/pati-iftli-i` reposunu içe aktarın. Framework: **Other**; derleme ayarlarını boş bırakın (`vercel.json` hazır).
2. Proje içinde **Storage** sekmesinden:
   - **Neon (Postgres)** veritabanı oluşturup projeye bağlayın → `DATABASE_URL` otomatik eklenir.
   - **Blob** deposu oluşturup bağlayın → `BLOB_READ_WRITE_TOKEN` otomatik eklenir.
3. **Settings → Environment Variables** bölümüne ekleyin:
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` — yönetici hesabı (güçlü bir şifre seçin).
   - `PAYMENT_PROVIDER=test` — gerçek ödeme bağlanana kadar kredi alımını test modunda açmak için. Eklenmezse satış kapalı kalır.
4. **Redeploy** (ortam değişkenleri yalnızca yeni yayında geçerli olur). Tablolar ve örnek ilanlar ilk API isteğinde otomatik oluşturulur.
5. Kontrol: `https://<site>/api/health` hangi parçanın (veritabanı, Blob, yönetici, ödeme modu) eksik olduğunu gösterir.

Not: Giriş denemesi sınırlaması bellek içidir; sunucusuz ortamda her örnek için ayrı sayılır.
