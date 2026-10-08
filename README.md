# Pati Çiftliği

Türkçe, mobil uyumlu köpek çiftliği ve ilan platformu: üyelik, kredi cüzdanı, ilan verme / öne çıkarma, yönetici onayı, rezervasyon talepleri ve yönetim paneli.

## Çalıştırma

Gereksinim: **Node.js 22.13+** (ek paket kurulumu yok; veri tabanı Node'un yerleşik `node:sqlite` modülü).

```powershell
npm start
```

Tarayıcıda http://localhost:3000 adresini açın. İlk açılışta yönetici hesabı yoksa terminale `admin@pati.local` için tek seferlik bir şifre yazdırılır. Kalıcı yönetici için `.env.example` dosyasını `.env` olarak kopyalayıp `ADMIN_EMAIL` ve `ADMIN_PASSWORD` girin (her açılışta bu hesap yönetici yapılır ve şifresi güncellenir).

Geliştirirken `npm run dev` sunucuyu dosya değişikliklerinde yeniden başlatır. Sözdizimi kontrolü: `npm run check`.

## Yapı

- `server/index.js` — HTTP sunucusu, statik dosyalar (`dist/`), yüklenen fotoğraflar, güvenlik başlıkları (CSP vb.).
- `server/api.js` — JSON API: üyelik/oturum, ilanlar, kredi defteri, siparişler, rezervasyonlar, yönetim.
- `server/db.js` — SQLite şeması ve örnek ilanlar. Veriler `data/` klasöründe (git dışı).
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

## Yayın

Mevcut Sites yayını (`.openai/hosting.json`, https://pati-ciftligi-dunyasi.mss881.chatgpt.site) yalnızca statik dosya sunar; bu sürüm Node sunucusu gerektirir. Node çalıştırabilen bir sunucuya (VPS, Render, Railway, Fly.io vb.) kalıcı `data/` diskiyle kurun ve `NODE_ENV=production`, HTTPS arkasında `COOKIE_SECURE=1`, ters vekil sunucu varsa `TRUST_PROXY=1` ayarlayın.
