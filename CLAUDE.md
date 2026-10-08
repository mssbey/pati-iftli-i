# Proje devri

## Amaç

Çiftliği tanıtan; sahiplendirme, eş bulma, kayıp ve mama/aksesuar ilanları sunan; kredi satın alma ve krediyle ilan açma/öne çıkarma akışları içeren Türkçe bir platform. Irk kütüphanesi, veteriner değerlendirmesine dayalı aşı rehberi ve eğitim içerikleri de isteniyor. Gelecekte mobil uygulamalara hizmet verecek API-first mimari hedefleniyor.

## Mevcut uygulama

- Bağımlılıksız Node.js sunucusu (`server/`, yerleşik `node:sqlite`) + buildless ön yüz (`dist/index.html`, `dist/styles.css`, `dist/app.js`). Ayrıntılar README'de.
- Doğal yeşil, krem ve açık limon tonları; Manrope/DM Sans fontları; SVG ikon seti `index.html` içindeki sprite'ta.
- Çalışan: üyelik/oturum, rol (user/admin), kredi defteri (idempotent `ref`), ilan oluşturma (fotoğraf yüklemeli) ve öne çıkarma, yönetici onay/ret (ret kredi iadesi), rezervasyon talepleri, yönetim paneli (günlük satış, kullanıcılar, talepler, bekleyen ilanlar).
- Kredi satın alma giriş gerektirir; ödeme yalnızca `test` modunda (tahsilat yok). Gerçek sağlayıcı yok.
- Ön yüzde kullanıcı verisi her zaman `esc()` ile kaçırılarak HTML'e yazılır.
- Favoriler hâlâ yalnızca `localStorage`'da.
- Aşı rehberi kesin doz/tarih vermiyor; veteriner planlamasına yönlendiriyor.

## Geliştirme kapsamı

1. Gerçek çiftlik adı, iletişim bilgileri, fotoğraf/video galerisi, hijyen/üretim politikaları, damızlık ve doğrulanmış pedigree kayıtları.
2. API-first backend, veri tabanı, üyelik ve rol bazlı yetkilendirme.
3. Güvenli fotoğraf yükleme, ilan CRUD, yönetici onayı, rezervasyonlar ve mesajlaşma.
4. Sunucu tarafında kredi cüzdanı ve işlem defteri; ilan/doping maliyetlerinin atomik düşülmesi.
5. iyzico veya PayTR entegrasyonu: sağlayıcı hesabı ve gizli bilgiler gerekir. Ödeme doğrulaması sunucuda, webhook imza kontrolü ve tekrar bildirimlere karşı idempotency ile uygulanmalı. Kart verisi uygulamada saklanmamalı.
6. Günlük satış, kullanıcılar, rezervasyonlar ve bekleyen ilanları gösteren yetkili yönetim paneli.
7. SEO içerikleri, ırk detayları, veteriner tarafından doğrulanmış sağlık içerikleri.

## Çalışma notları

- Yerel çalıştırma: `npm start` → http://localhost:3000 (statik `http.server` artık yetmez; API gerekir). Kontrol: `npm run check`.
- Dosyalar UTF-8. `repair.py` ilk yayındaki bir kodlama hatası için tek seferlik kullanıldı; tekrar çalıştırma.
- `.openai/hosting.json` mevcut Sites kimliğini içerir. Başka hosting seçilirse ilgili dağıtım yapılandırması ayrıca hazırlanmalı.
- Gerçek servisler bağlanana kadar demo açıklamalarını ve örnek içerik etiketlerini koru.
- Gerçek çiftlik bilgileri, belge ve referansları uydurma. Gerekli bilgileri proje sahibinden al.
- Yayın yardımcılarını günlük uygulama kaynakları olarak değerlendirme.
