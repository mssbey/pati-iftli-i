'use strict';

/* ================= yardımcılar ================= */

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ic = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const num = n => new Intl.NumberFormat('tr-TR').format(n);
const money = n => '₺' + new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
const parseDate = s => new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z'));
const dateFmt = s => parseDate(s).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = s => parseDate(s).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
const firstName = name => String(name || '').split(/\s+/)[0];
const initials = name => String(name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toLocaleUpperCase('tr-TR');

function timeAgo(s) {
  const diff = (Date.now() - parseDate(s)) / 1000;
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} dk önce`;
  if (diff < 86400) return `${Math.round(diff / 3600)} saat önce`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} gün önce`;
  return dateFmt(s);
}

const CATS = {
  adoption: { label: 'Sahiplendirme', icon: 'heart' },
  mate: { label: 'Eş bulma', icon: 'spark' },
  lost: { label: 'Kayıp dost', icon: 'search' },
  accessory: { label: 'Mama & aksesuar', icon: 'leaf' },
};
const ANIMALS = { dog: 'Köpek', cat: 'Kedi', other: 'Diğer' };
const STATUS = { pending: 'Onay bekliyor', approved: 'Yayında', rejected: 'Reddedildi', paid: 'Ödendi', cancelled: 'İptal', new: 'Yeni', confirmed: 'Onaylandı' };
const CITIES = ['Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Aksaray', 'Amasya', 'Ankara', 'Antalya', 'Ardahan', 'Artvin', 'Aydın', 'Balıkesir', 'Bartın', 'Batman', 'Bayburt', 'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli', 'Diyarbakır', 'Düzce', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkari', 'Hatay', 'Iğdır', 'Isparta', 'İstanbul', 'İzmir', 'Kahramanmaraş', 'Karabük', 'Karaman', 'Kars', 'Kastamonu', 'Kayseri', 'Kilis', 'Kırıkkale', 'Kırklareli', 'Kırşehir', 'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Mardin', 'Mersin', 'Muğla', 'Muş', 'Nevşehir', 'Niğde', 'Ordu', 'Osmaniye', 'Rize', 'Sakarya', 'Samsun', 'Şanlıurfa', 'Siirt', 'Sinop', 'Sivas', 'Şırnak', 'Tekirdağ', 'Tokat', 'Trabzon', 'Tunceli', 'Uşak', 'Van', 'Yalova', 'Yozgat', 'Zonguldak'];
const AUTH_IMG = 'https://images.unsplash.com/photo-1587300003388-59208cc962cb?auto=format&fit=crop&w=1400&q=80';

const state = {
  user: null,
  balance: 0,
  config: { packages: [], costs: { listing: 5, feature: 10 }, featureDays: 7, paymentMode: 'none' },
  favorites: readFavorites(),
  category: 'all',
  next: null,
  homeStale: true,
};

function readFavorites() {
  try { return JSON.parse(localStorage.getItem('pati-favorites') || '[]').map(Number).filter(Boolean); } catch { return []; }
}
function toggleFavorite(id) {
  state.favorites = state.favorites.includes(id) ? state.favorites.filter(x => x !== id) : [...state.favorites, id];
  try { localStorage.setItem('pati-favorites', JSON.stringify(state.favorites)); } catch { /* depolama kapalı */ }
  return state.favorites.includes(id);
}

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
    });
  } catch {
    throw Object.assign(new Error('Sunucuya ulaşılamadı. Uygulamayı “npm start” ile çalıştırdığınızdan emin olun.'), { status: 0 });
  }
  let data = {};
  try { data = await res.json(); } catch { /* boş yanıt */ }
  if (!res.ok) {
    if (res.status === 401 && state.user && !path.startsWith('/api/auth/')) { state.user = null; renderHeader(); }
    throw Object.assign(new Error(data.error || 'Sunucuya ulaşılamadı. Uygulamayı “npm start” ile çalıştırdığınızdan emin olun.'), { status: res.status });
  }
  return data;
}

function toast(message, type = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${type === 'error' ? 'error' : ''}`;
  t.setAttribute('role', 'status');
  t.innerHTML = ic(type === 'error' ? 'close' : 'check');
  t.append(message);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4200);
}

function busy(btn, on) {
  if (!btn) return;
  btn.classList.toggle('loading', on);
  btn.disabled = on;
}

function setAccount(data) {
  state.user = data.user || null;
  state.balance = data.balance || 0;
}
function setBalance(balance) {
  state.balance = balance;
  renderHeader();
}

/* ================= modal ================= */

const dialog = $('#modal');
let onModalClose = null;

function openModal(html, { wide = false, onClose = null } = {}) {
  $('#modal-content').innerHTML = html;
  dialog.classList.toggle('wide', wide);
  onModalClose = onClose;
  if (!dialog.open) dialog.showModal();
}
function closeModal() {
  if (dialog.open) dialog.close();
}
dialog.addEventListener('close', () => {
  const fn = onModalClose;
  onModalClose = null;
  fn?.();
});
$('.modal-close').addEventListener('click', closeModal);
dialog.addEventListener('click', e => { if (e.target === dialog) closeModal(); });

function confirmModal({ title, text, ok = 'Onayla', danger = false }) {
  return new Promise(resolve => {
    let result = false;
    openModal(`<h2 id="modal-title">${esc(title)}</h2><p>${text}</p>
      <div class="row-gap" style="margin-top:22px"><button class="btn ${danger ? 'danger' : ''}" id="cm-ok">${esc(ok)}</button><button class="btn outline" id="cm-cancel">Vazgeç</button></div>`,
    { onClose: () => resolve(result) });
    $('#cm-ok').onclick = () => { result = true; closeModal(); };
    $('#cm-cancel').onclick = closeModal;
  });
}

/* ================= üst menü ================= */

function renderHeader() {
  const box = $('#header-actions');
  if (!state.user) {
    box.innerHTML = `<a class="btn ghost sm" href="#/giris">Giriş yap</a><a class="btn sm" href="#/ilan-ver">${ic('plus')} İlan ver</a>`;
    return;
  }
  const u = state.user;
  box.innerHTML = `
    <a class="credit-pill" href="#/krediler" title="Kredi bakiyeniz">${ic('coin')}<span>${num(state.balance)}</span><span class="hide-sm">kredi</span></a>
    <a class="btn sm hide-sm" href="#/ilan-ver">${ic('plus')} İlan ver</a>
    <div class="user-menu">
      <button class="avatar" id="avatar" aria-haspopup="true" aria-expanded="false" aria-label="Hesap menüsü">${esc(initials(u.name))}</button>
      <div class="dropdown" id="dropdown" hidden>
        <header><b>${esc(u.name)}</b><small>${esc(u.email)}</small></header>
        <a href="#/hesabim">${ic('user')} Hesabım</a>
        <a href="#/krediler">${ic('coin')} Krediler · ${num(state.balance)}</a>
        <a href="#/ilan-ver">${ic('plus')} Yeni ilan</a>
        ${u.role === 'admin' ? `<a href="#/yonetim">${ic('grid')} Yönetim paneli</a>` : ''}
        <button data-action="logout">${ic('logout')} Çıkış yap</button>
      </div>
    </div>`;
}

function closeMenus() {
  $('#dropdown')?.setAttribute('hidden', '');
  $('#avatar')?.setAttribute('aria-expanded', 'false');
  $('#main-nav').classList.remove('open');
  $('#menu-toggle').setAttribute('aria-expanded', 'false');
}

/* ================= ana sayfa ================= */

const BREEDS = [
  { name: 'Golden Retriever', kind: 'Köpek · Büyük', text: 'İnsan odaklı, uysal ve öğrenmeye hevesli. Aktif ailelerin sadık yol arkadaşı.', traits: [4, 4, 5, 2],
    care: ['Günlük uzun yürüyüş ve oyun', 'Haftada birkaç kez tarama; tüy dökümü mevsimsel artar', 'Kilo ve eklem sağlığı takibi'] },
  { name: 'Labrador Retriever', kind: 'Köpek · Büyük', text: 'Neşeli, sosyal ve oyuncu. Suyu ve yiyeceği sever; düzenli egzersizle dengelenir.', traits: [4, 2, 5, 2],
    care: ['Yüksek egzersiz ihtiyacı', 'Porsiyon kontrolü önemli', 'Kısa tüy, düzenli tarama yeterli'] },
  { name: 'Border Collie', kind: 'Köpek · Orta', text: 'Son derece zeki ve çalışkan. Zihinsel uğraş verilmezse sıkılabilir.', traits: [5, 3, 4, 1],
    care: ['Her gün zihinsel oyun ve eğitim', 'Geniş alanda hareket', 'Erken sosyalleşme'] },
  { name: 'Pomeranian', kind: 'Köpek · Küçük', text: 'Minik ama özgüvenli. Canlı, uyanık ve sahibine bağlı.', traits: [3, 4, 3, 5],
    care: ['Yoğun tüyler için düzenli tarama', 'Diş bakımına özen', 'Kısa ama sık yürüyüşler'] },
  { name: 'Fransız Bulldog', kind: 'Köpek · Küçük', text: 'Sakin, sevecen ve şehir hayatına uyumlu. Basık burun nedeniyle sıcağa duyarlı.', traits: [2, 1, 4, 5],
    care: ['Sıcak havada yoğun egzersizden kaçının', 'Yüz kıvrımlarının temizliği', 'Solunum belirtilerini veterinerle takip edin'] },
  { name: 'British Shorthair', kind: 'Kedi', text: 'Dengeli, sakin ve bağımsız. Ev içi yaşama kolayca uyum sağlar.', traits: [2, 2, 4, 5],
    care: ['Haftalık tüy tarama', 'Oyunla hareket teşviki', 'Kilo takibi'] },
];
const TRAITS = ['Enerji', 'Tüy bakımı', 'Aile uyumu', 'Apartman uyumu'];
const meter = v => `<span class="meter">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= v ? 'on' : ''}"></i>`).join('')}</span>`;

function renderBreeds() {
  $('#breed-grid').innerHTML = BREEDS.map((b, i) => `
    <button class="breed" data-breed="${i}">
      <div class="breed-top"><span class="mono">${esc(initials(b.name))}</span><div><h3>${esc(b.name)}</h3><small>${esc(b.kind)}</small></div></div>
      <p>${esc(b.text)}</p>
      <div class="traits">${b.traits.map((v, t) => `<div class="trait"><span>${TRAITS[t]}</span>${meter(v)}</div>`).join('')}</div>
    </button>`).join('');
}

function showBreed(i) {
  const b = BREEDS[i];
  openModal(`<div class="eyebrow">${esc(b.kind.toLocaleUpperCase('tr-TR'))}</div><h2 id="modal-title">${esc(b.name)}</h2><p>${esc(b.text)}</p>
    <div class="traits" style="margin:18px 0">${b.traits.map((v, t) => `<div class="trait"><span>${TRAITS[t]}</span>${meter(v)}</div>`).join('')}</div>
    <h3 style="font-size:16px;margin:20px 0 10px">Bakım notları</h3>
    <ul class="vlist">${b.care.map(c => `<li>${ic('check')}<span>${esc(c)}</span></li>`).join('')}</ul>
    <p class="fine">Genel eğilimlerdir; her hayvan bireyseldir. Sağlık konularında veteriner hekiminize danışın.</p>
    <button class="btn" data-breed-search="${esc(b.name)}" style="margin-top:12px">${ic('search')} Bu ırktaki ilanları gör</button>`);
}

const VACCINE = {
  dog: {
    puppy: [['İlk muayene', 'Genel sağlık kontrolü, kilo ve gelişim takibi.'], ['Temel aşı serisi', 'Hangi aşıların hangi aralıklarla yapılacağını veteriner hekim planlar.'], ['Parazit koruması', 'İç ve dış parazit uygulamalarının zamanlaması.'], ['Mikroçip ve kayıt', 'Kimlik kaydı ve sağlık karnesinin düzenlenmesi.'], ['Sosyalleşme', 'Aşı süreci tamamlanana kadar güvenli sosyalleşme önerileri.']],
    adult: [['Kayıt kontrolü', 'Önceki aşı ve sağlık kayıtlarının gözden geçirilmesi.'], ['Tekrar dozları', 'Yaşam tarzı ve risklere göre bireysel plan; yasal zorunlu aşıların (ör. kuduz) güncelliği.'], ['Parazit koruması', 'Düzenli koruma takvimi.'], ['Ağız ve diş sağlığı', 'Diş taşı ve diş eti kontrolü.']],
    senior: [['Daha sık kontrol', 'Veterinerin önereceği aralıklarla genel muayene.'], ['Tahlil ve tarama', 'Kan tahlilleri ve organ fonksiyon takibi.'], ['Eklem sağlığı', 'Hareket kısıtlılıkları ve ağrı belirtileri.'], ['Bireysel aşı planı', 'Aşı planının genel sağlık durumuna göre düzenlenmesi.']],
  },
  cat: {
    puppy: [['İlk muayene', 'Genel sağlık kontrolü ve gelişim takibi.'], ['Temel aşı serisi', 'Aşı türleri ve aralıkları veteriner hekim tarafından belirlenir.'], ['Testler', 'Gerekli görülen enfeksiyon testlerinin veterinerle konuşulması.'], ['Parazit koruması', 'İç ve dış parazit uygulamaları.'], ['Kısırlaştırma', 'Uygun zamanlamanın planlanması.']],
    adult: [['Kayıt kontrolü', 'Önceki aşı ve sağlık kayıtlarının gözden geçirilmesi.'], ['Yaşam tarzı', 'Ev içi ya da dışarı çıkan kedi için farklı risklerin değerlendirilmesi.'], ['Tekrar dozları', 'Bireysel plan; yasal zorunlu aşıların (ör. kuduz) güncelliği.'], ['Diş ve kilo', 'Ağız sağlığı ve ideal kilo takibi.']],
    senior: [['Daha sık kontrol', 'Veterinerin önereceği aralıklarla genel muayene.'], ['Böbrek ve tiroid', 'İleri yaşta sık görülen sorunlar için tarama.'], ['Kilo ve iştah', 'Ani değişimler veterinere danışılmalı.'], ['Bireysel aşı planı', 'Aşı planının sağlık durumuna göre düzenlenmesi.']],
  },
};
const vaccineState = { species: 'dog', stage: 'puppy' };
function renderVaccine() {
  $('#v-output').innerHTML = VACCINE[vaccineState.species][vaccineState.stage]
    .map(([t, d]) => `<li>${ic('check')}<span><b>${esc(t)}.</b> ${esc(d)}</span></li>`).join('');
}

function renderPricing() {
  const { packages, costs, paymentMode } = state.config;
  const html = packages.length ? packages.map(p => `
    <div class="price ${p.popular ? 'popular' : ''}">
      ${p.popular ? '<span class="ribbon">EN POPÜLER</span>' : ''}
      <h3>${esc(p.name)}</h3>
      <div class="credits">${p.credits}<small>kredi</small></div>
      <div class="amount">${money(p.price)}</div>
      <div class="per">Kredi başına ${money(+(p.price / p.credits).toFixed(2))}</div>
      <ul>
        <li>${ic('check')} ${Math.floor(p.credits / costs.listing)} ilan oluşturma</li>
        <li>${ic('check')} ya da ${Math.floor(p.credits / costs.feature)} kez öne çıkarma</li>
        <li>${ic('check')} ${esc(p.note)}</li>
      </ul>
      <button class="btn lg block" data-buy="${esc(p.id)}">${state.user ? 'Satın al' : 'Giriş yap ve satın al'}</button>
    </div>`).join('') : '<div class="empty">Kredi paketleri sunucu bağlandığında görünecek.</div>';
  for (const el of $$('[data-pricing]')) el.innerHTML = html;
  $('#pricing').innerHTML = html;
  $$('[data-cost="listing"]').forEach(el => (el.textContent = costs.listing));
  $$('[data-cost="feature"]').forEach(el => (el.textContent = costs.feature));
  $('#payment-note').innerHTML = paymentMode === 'test'
    ? `${ic('lock')} Test modu: Ödeme sağlayıcısı bağlanana kadar gerçek tahsilat yapılmaz. Kart bilgisi istenmez.`
    : paymentMode === 'none' ? `${ic('clock')} Kredi satışı ödeme altyapısı tamamlandığında açılacak.` : `${ic('lock')} Ödemeler güvenli ödeme sağlayıcısı üzerinden alınır.`;
}

function card(l) {
  const saved = state.favorites.includes(l.id);
  const chips = [ANIMALS[l.animal], l.age, l.sex].filter(x => x && x !== '—');
  return `<article class="card ${l.featured ? 'featured' : ''}" data-href="#/ilan/${l.id}" tabindex="0" aria-label="${esc(l.title)}">
    <div class="photo">
      ${l.photo ? `<img loading="lazy" src="${esc(l.photo)}" alt="${esc(l.title)}">` : `<span class="ph">${ic('paw')}</span>`}
      <div class="badges">${l.featured ? `<span class="badge star">${ic('star')} Vitrin</span>` : ''}<span class="badge ${l.category}">${CATS[l.category]?.label ?? ''}</span></div>
      <button class="heart ${saved ? 'saved' : ''}" data-fav="${l.id}" aria-pressed="${saved}" aria-label="${saved ? 'Favorilerden çıkar' : 'Favorilere ekle'}">${ic('heart')}</button>
    </div>
    <div class="card-body">
      <div class="meta"><span>${esc(l.breed)}</span>${l.isSample ? '<span class="sample">Örnek ilan</span>' : `<span>${timeAgo(l.createdAt)}</span>`}</div>
      <h3>${esc(l.title)}</h3>
      <div class="chips">${chips.map(c => `<span>${esc(c)}</span>`).join('')}</div>
      <div class="card-foot"><span>${ic('pin')} ${esc(l.city)}</span><span class="go">Tanışalım ${ic('arrow')}</span></div>
    </div>
  </article>`;
}

const emptyBox = (title, text, extra = '') => `<div class="empty">${ic('paw')}<b>${esc(title)}</b>${esc(text)}${extra}</div>`;

let listingRequest = 0;
async function loadListings() {
  const grid = $('#cards');
  const req = ++listingRequest;
  grid.innerHTML = Array(4).fill('<div class="skeleton"></div>').join('');
  const params = new URLSearchParams();
  const favorites = state.category === 'favorites';
  if (!favorites && state.category !== 'all') params.set('category', state.category);
  for (const [key, id] of [['animal', 'f-animal'], ['breed', 'f-breed'], ['city', 'f-city']]) {
    const v = $('#' + id).value;
    if (v !== 'all') params.set(key, v);
  }
  const q = $('#f-q').value.trim();
  if (q) params.set('q', q);
  if (favorites) params.set('limit', '100');
  try {
    let { listings } = await api('/api/listings?' + params);
    if (req !== listingRequest) return;
    if (favorites) listings = listings.filter(l => state.favorites.includes(l.id));
    grid.innerHTML = listings.length ? listings.map(card).join('') : favorites
      ? emptyBox('Henüz favoriniz yok', 'Beğendiğiniz ilanlardaki kalp simgesine dokunarak burada toplayabilirsiniz.')
      : emptyBox('Bu filtrelere uygun ilan bulunamadı', 'Filtreleri değiştirerek tekrar deneyin.', '<br><button class="btn outline sm" data-action="reset-filters" style="margin-top:14px">Filtreleri temizle</button>');
  } catch (e) {
    if (req === listingRequest) grid.innerHTML = emptyBox('İlanlar yüklenemedi', e.message);
  }
}

async function loadHomeData() {
  state.homeStale = false;
  loadListings();
  try {
    const [stats, facets] = await Promise.all([api('/api/stats'), api('/api/listings/facets')]);
    $('#stat-total').textContent = num(stats.total);
    $('#stat-cities').textContent = num(stats.cities);
    for (const [k, v] of Object.entries(stats.counts)) $$(`[data-count="${k}"]`).forEach(el => (el.textContent = v));
    for (const [id, list, all] of [['f-breed', facets.breeds, 'Tüm ırklar'], ['f-city', facets.cities, 'Tüm Türkiye']]) {
      const sel = $('#' + id);
      const current = sel.value;
      sel.innerHTML = `<option value="all">${all}</option>` + list.map(v => `<option>${esc(v)}</option>`).join('');
      sel.value = list.includes(current) ? current : 'all';
    }
  } catch { /* hata ilan alanında gösteriliyor */ }
}

function setCategory(cat) {
  state.category = cat;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.category === cat));
  loadListings();
}

/* ================= yönlendirme ================= */

const ROUTES = [
  [/^#\/giris$/, () => authPage('login')],
  [/^#\/kayit$/, () => authPage('register')],
  [/^#\/ilan\/(\d+)$/, id => detailPage(Number(id))],
  [/^#\/ilan-ver$/, () => requireAuth(newListingPage)],
  [/^#\/krediler$/, () => requireAuth(creditsPage)],
  [/^#\/hesabim$/, () => requireAuth(accountPage)],
  [/^#\/yonetim$/, () => requireAuth(adminPage, true)],
];

function router() {
  const hash = location.hash;
  closeMenus();
  if (dialog.open) closeModal();
  if (!hash.startsWith('#/') || hash === '#/') {
    const wasHidden = $('#home').hidden;
    $('#page').hidden = true;
    $('#page').innerHTML = '';
    $('#home').hidden = false;
    if (state.homeStale) loadHomeData();
    const target = hash.length > 1 && !hash.startsWith('#/') ? document.getElementById(hash.slice(1)) : null;
    if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: wasHidden ? 'auto' : 'smooth' }));
    else if (wasHidden) window.scrollTo(0, 0);
    return;
  }
  const match = ROUTES.find(([re]) => re.test(hash));
  if (!match) return location.replace('#/');
  $('#home').hidden = true;
  $('#page').hidden = false;
  state.homeStale = true;
  window.scrollTo(0, 0);
  match[1](...hash.match(match[0]).slice(1));
}

function requireAuth(render, admin = false) {
  if (!state.user) {
    state.next = location.hash;
    return location.replace('#/giris');
  }
  if (admin && state.user.role !== 'admin') {
    return setPage(shell(emptyBox('Bu alan yalnızca yöneticilere açık', 'Yetkili bir hesapla giriş yapmanız gerekiyor.', '<br><a class="btn sm" href="#/" style="margin-top:14px">Ana sayfaya dön</a>')));
  }
  render();
}

const setPage = html => ($('#page').innerHTML = html);
const shell = html => `<div class="wrap page">${html}</div>`;
const loading = () => setPage('<div class="loader" role="status" aria-label="Yükleniyor"></div>');
const crumbs = items => `<nav class="crumbs" aria-label="Konum"><a href="#/">${ic('home')} Ana sayfa</a>${items.map(([t, h]) => `<span>/</span>${h ? `<a href="${h}">${esc(t)}</a>` : `<span>${esc(t)}</span>`}`).join('')}</nav>`;
const pageError = e => setPage(shell(emptyBox('Bir sorun oluştu', e.message, '<br><a class="btn sm" href="#/" style="margin-top:14px">Ana sayfaya dön</a>')));

/* ================= giriş & kayıt ================= */

const NEXT_NOTICE = {
  '#/krediler': 'Kredi satın almak için lütfen giriş yapın ya da ücretsiz hesap oluşturun.',
  '#/ilan-ver': 'İlan vermek için lütfen giriş yapın ya da ücretsiz hesap oluşturun.',
  '#/hesabim': 'Hesabınızı görüntülemek için giriş yapın.',
};

function authPage(mode) {
  if (state.user) return location.replace(state.next || '#/hesabim');
  const reg = mode === 'register';
  const notice = state.next && (NEXT_NOTICE[state.next] || 'Devam etmek için giriş yapın.');
  setPage(`<section class="auth">
    <div class="auth-visual">
      <img src="${AUTH_IMG}" alt="">
      <div>
        <div class="eyebrow light">PATİ AİLESİNE KATILIN</div>
        <h2>Favorileriniz, ilanlarınız ve kredileriniz tek yerde.</h2>
        <p>Ücretsiz hesabınızla ilan verin, onay sürecini takip edin ve dostlarınızı daha çok kişiye ulaştırın.</p>
        <ul class="auth-perks">
          <li>${ic('heart')} Beğendiğiniz dostları favorilerinize ekleyin</li>
          <li>${ic('coin')} Kredi yükleyin, ilanlarınızı vitrine taşıyın</li>
          <li>${ic('shield')} İlan onay durumunu anlık takip edin</li>
        </ul>
      </div>
    </div>
    <div class="auth-panel"><div class="auth-card">
      <div class="auth-switch" role="tablist"><a href="#/giris" class="${reg ? '' : 'active'}">Giriş yap</a><a href="#/kayit" class="${reg ? 'active' : ''}">Kayıt ol</a></div>
      <h1>${reg ? 'Hesap oluşturun' : 'Tekrar hoş geldiniz'}</h1>
      <p>${reg ? 'Birkaç saniyede ücretsiz üye olun.' : 'Hesabınıza giriş yaparak devam edin.'}</p>
      ${notice ? `<div class="notice">${ic('lock')}<span>${esc(notice)}</span></div>` : ''}
      ${state.config.demo ? `<div class="demo-box">
        <div class="demo-head"><span class="demo-icon">${ic('spark')}</span><div><b>Demo hesapla deneyin</b><small>Kredisi hazır; ilan verip kredi akışını hemen görebilirsiniz.</small></div></div>
        <div class="demo-creds"><span>${ic('mail')} ${esc(state.config.demo.email)}</span><span>${ic('lock')} ${esc(state.config.demo.password)}</span></div>
        <button type="button" class="btn lime block" id="demo-login">${ic('right')} Demo hesapla giriş yap</button>
      </div>
      <div class="or"><span>${reg ? 'ya da yeni hesap oluşturun' : 'ya da kendi hesabınızla'}</span></div>` : ''}
      <form class="form" id="auth-form">
        ${reg ? `<label>Ad soyad<span class="input-icon">${ic('user')}<input name="name" required minlength="2" maxlength="60" autocomplete="name" placeholder="Adınız Soyadınız"></span></label>` : ''}
        <label>E-posta<span class="input-icon">${ic('mail')}<input name="email" type="email" required maxlength="120" autocomplete="email" placeholder="ornek@eposta.com"></span></label>
        <label>Şifre<span class="input-icon">${ic('lock')}<input name="password" type="password" required minlength="${reg ? 8 : 1}" maxlength="128" autocomplete="${reg ? 'new-password' : 'current-password'}" placeholder="${reg ? 'En az 8 karakter' : 'Şifreniz'}"><button type="button" class="pw-toggle" aria-label="Şifreyi göster">${ic('eye')}</button></span></label>
        ${reg ? `<label class="check"><input type="checkbox" name="terms" required><span><button type="button" class="link" data-action="terms">Kullanım koşullarını</button> ve <button type="button" class="link" data-action="privacy">gizlilik bilgilendirmesini</button> okudum, kabul ediyorum.</span></label>` : ''}
        <div class="form-error" id="auth-error" role="alert"></div>
        <button class="btn lg block" type="submit">${reg ? 'Hesabımı oluştur' : 'Giriş yap'} ${ic('right')}</button>
      </form>
      <p class="auth-foot">${reg ? 'Zaten hesabınız var mı? <a class="link" href="#/giris">Giriş yapın</a>' : 'Hesabınız yok mu? <a class="link" href="#/kayit">Ücretsiz kayıt olun</a>'}</p>
    </div></div>
  </section>`);

  const form = $('#auth-form');
  const demoBtn = $('#demo-login');
  if (demoBtn) demoBtn.onclick = async () => {
    busy(demoBtn, true);
    try {
      setAccount(await api('/api/auth/login', { method: 'POST', body: state.config.demo }));
      renderHeader();
      renderPricing();
      toast(`Demo hesapla giriş yaptınız. Bakiyeniz: ${num(state.balance)} kredi.`);
      const next = state.next || '#/ilan-ver';
      state.next = null;
      location.replace(next);
    } catch (ex) {
      toast(ex.message, 'error');
      busy(demoBtn, false);
    }
  };
  $('.pw-toggle', form).onclick = e => {
    const input = form.password;
    input.type = input.type === 'password' ? 'text' : 'password';
    e.currentTarget.setAttribute('aria-label', input.type === 'password' ? 'Şifreyi göster' : 'Şifreyi gizle');
  };
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = $('button[type="submit"]', form);
    const err = $('#auth-error');
    err.classList.remove('show');
    busy(btn, true);
    try {
      const fd = new FormData(form);
      const body = { email: fd.get('email'), password: fd.get('password') };
      if (reg) Object.assign(body, { name: fd.get('name'), terms: fd.get('terms') === 'on' });
      setAccount(await api(reg ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body }));
      renderHeader();
      renderPricing();
      toast(reg ? `Hoş geldiniz, ${firstName(state.user.name)}! Hesabınız oluşturuldu.` : `Tekrar hoş geldiniz, ${firstName(state.user.name)}.`);
      const next = state.next || '#/hesabim';
      state.next = null;
      location.replace(next);
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.add('show');
      busy(btn, false);
    }
  };
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* yine de çıkış */ }
  state.user = null;
  state.balance = 0;
  renderHeader();
  renderPricing();
  toast('Çıkış yaptınız. Görüşmek üzere!');
  location.hash = '#/';
}

/* ================= kredi satın alma ================= */

async function startCheckout(packageId, btn) {
  if (!state.user) {
    state.next = '#/krediler';
    toast('Kredi satın almak için önce giriş yapın.');
    return (location.hash = '#/giris');
  }
  busy(btn, true);
  try {
    const { order, paymentMode } = await api('/api/credits/orders', { method: 'POST', body: { packageId } });
    let paid = false;
    openModal(`<div class="eyebrow">GÜVENLİ ÖDEME</div><h2 id="modal-title">Ödemeyi tamamlayın</h2>
      ${paymentMode === 'test' ? `<div class="notice warn">${ic('lock')}<span><b>Test modu.</b> Ödeme sağlayıcısı (iyzico / PayTR) bağlanana kadar gerçek tahsilat yapılmaz ve kart bilgisi istenmez. Onayladığınızda krediler hesabınıza tanımlanır.</span></div>` : ''}
      <div class="pay-summary">
        <div><span>Paket</span><b>${esc(order.name)}</b></div>
        <div><span>Kredi</span><b>${num(order.credits)} kredi</b></div>
        <div><span>Sipariş no</span><span>#${order.id}</span></div>
        <div class="total"><span>Toplam</span><span>${money(order.price)}</span></div>
      </div>
      <div class="row-gap"><button class="btn lg" id="pay-confirm">${ic('lock')} ${paymentMode === 'test' ? 'Test ödemesini onayla' : 'Ödemeye geç'}</button><button class="btn outline lg" id="pay-cancel">Vazgeç</button></div>`,
    { onClose: () => { if (!paid) api(`/api/credits/orders/${order.id}/cancel`, { method: 'POST' }).catch(() => {}); } });
    $('#pay-cancel').onclick = closeModal;
    $('#pay-confirm').onclick = async e => {
      busy(e.currentTarget, true);
      try {
        const res = await api(`/api/payments/test/${order.id}/confirm`, { method: 'POST' });
        paid = true;
        setBalance(res.balance);
        closeModal();
        toast(`${num(res.credits)} kredi hesabınıza eklendi. Yeni bakiye: ${num(res.balance)}`);
        if (location.hash === '#/krediler') creditsPage();
        else if (location.hash === '#/hesabim') accountPage();
        else if (location.hash === '#/ilan-ver') newListingPage();
      } catch (ex) {
        toast(ex.message, 'error');
        busy(e.currentTarget, false);
      }
    };
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    busy(btn, false);
  }
}

async function creditsPage() {
  loading();
  try {
    const { entries, balance } = await api('/api/me/ledger');
    setBalance(balance);
    const { costs, featureDays } = state.config;
    setPage(shell(`${crumbs([['Krediler']])}
      <div class="page-head"><div><div class="eyebrow">KREDİ CÜZDANI</div><h1>Krediler</h1><p>Krediler hesabınıza tanımlanır; ilan oluşturma ve öne çıkarma işlemlerinde kullanılır.</p></div></div>
      <div class="stat-grid">
        <div class="stat dark"><small>${ic('coin')} Mevcut bakiye</small><b>${num(balance)}</b><em>kredi</em></div>
        <div class="stat"><small>${ic('plus')} İlan oluşturma</small><b>${costs.listing}</b><em>kredi / ilan</em></div>
        <div class="stat"><small>${ic('bolt')} Öne çıkarma</small><b>${costs.feature}</b><em>kredi / ${featureDays} gün</em></div>
        <div class="stat"><small>${ic('shield')} İade</small><b>Otomatik</b><em>reddedilen ilanlarda</em></div>
      </div>
      <div class="panel"><div class="panel-head"><h3>Paket seçin</h3></div><div class="pricing" data-pricing></div><p class="fine center">${$('#payment-note').innerHTML}</p></div>
      <div class="panel"><div class="panel-head"><h3>Hesap hareketleri</h3></div>${ledgerTable(entries)}</div>`));
    renderPricing();
  } catch (e) { pageError(e); }
}

const ledgerTable = entries => entries.length ? `<div class="table-wrap"><table>
  <thead><tr><th>Tarih</th><th>Açıklama</th><th style="text-align:right">Kredi</th></tr></thead>
  <tbody>${entries.map(x => `<tr><td>${dateTimeFmt(x.createdAt)}</td><td>${esc(x.reason)}</td><td style="text-align:right" class="${x.amount > 0 ? 'amount-pos' : 'amount-neg'}">${x.amount > 0 ? '+' : ''}${num(x.amount)}</td></tr>`).join('')}</tbody>
  </table></div>` : emptyBox('Henüz hareket yok', 'Kredi yüklediğinizde ve kullandığınızda burada listelenir.');

/* ================= ilan detay ================= */

async function detailPage(id) {
  loading();
  try {
    const { listing: l, mine } = await api(`/api/listings/${id}`);
    const saved = state.favorites.includes(l.id);
    const facts = [['Tür', ANIMALS[l.animal]], ['Irk', l.breed], ['Yaş', l.age || '—'], ['Cinsiyet', l.sex || '—'], ['Şehir', l.city], ['Kategori', CATS[l.category]?.label], ['İlan no', '#' + l.id], ['Yayın', l.isSample ? 'Örnek' : dateFmt(l.createdAt)]];
    setPage(shell(`${crumbs([['İlanlar', '#ilanlar'], [l.title]])}
      ${l.status === 'pending' ? `<div class="notice warn">${ic('clock')}<span>Bu ilan yönetici onayı bekliyor; şu an yalnızca siz görebiliyorsunuz.</span></div>` : ''}
      ${l.status === 'rejected' ? `<div class="notice warn">${ic('close')}<span>Bu ilan reddedildi: ${esc(l.rejectReason)}. Kredisi hesabınıza iade edildi.</span></div>` : ''}
      <div class="layout-2">
        <div>
          <div class="detail-gallery">${l.photo ? `<img src="${esc(l.photo)}" alt="${esc(l.title)}">` : `<span class="ph">${ic('paw')}</span>`}
            <div class="badges">${l.featured ? `<span class="badge star">${ic('star')} Vitrin</span>` : ''}<span class="badge ${l.category}">${CATS[l.category]?.label}</span>${l.isSample ? '<span class="badge">Örnek ilan</span>' : ''}</div>
          </div>
          <h1 class="detail-title">${esc(l.title)}</h1>
          <div class="meta" style="justify-content:flex-start;gap:16px;font-size:14px"><span>${ic('pin')} ${esc(l.city)}</span><span>${ic('clock')} ${l.isSample ? 'Örnek içerik' : timeAgo(l.createdAt)}</span></div>
          <div class="facts">${facts.map(([k, v]) => `<div><small>${k}</small><b>${esc(v)}</b></div>`).join('')}</div>
          <div class="panel"><h3 style="margin-bottom:12px">İlan açıklaması</h3><p class="prose">${esc(l.description)}</p></div>
        </div>
        <aside class="sticky">
          <div class="panel">
            <div class="owner"><span class="avatar">${esc(initials(l.owner))}</span><div><b>${esc(l.owner)}</b><small>${l.isSample ? 'Örnek ilan sahibi' : 'Pati Çiftliği üyesi'}</small></div></div>
            ${mine ? ownerActions(l) : `<div class="side-actions">
              <button class="btn lg block" data-action="inquire" data-id="${l.id}" data-title="${esc(l.title)}">${ic('chat')} ${l.category === 'lost' ? 'Bilgi ver' : 'Tanışma talebi gönder'}</button>
              <button class="btn outline block" data-fav-detail="${l.id}">${ic('heart')} <span>${saved ? 'Favorilerden çıkar' : 'Favorilere ekle'}</span></button>
              <button class="btn ghost block" data-action="share">${ic('share')} Bağlantıyı kopyala</button>
            </div>`}
            <div class="safety">
              <div>${ic('shield')}<span>İlanlar yayından önce yönetici tarafından incelenir.</span></div>
              <div>${ic('lock')}<span>Ödeme ya da kapora talep eden mesajlara karşı dikkatli olun.</span></div>
              <div>${ic('med')}<span>Sahiplenmeden önce sağlık kayıtlarını ve aşı karnesini isteyin.</span></div>
            </div>
          </div>
        </aside>
      </div>
      <section class="section"><div class="section-head"><div><div class="eyebrow">BENZER İLANLAR</div><h2>Bunlar da ilginizi çekebilir</h2></div><a class="btn outline" href="#ilanlar">Tüm ilanlar ${ic('right')}</a></div><div class="grid" id="similar"></div></section>`));
    api(`/api/listings?category=${l.category}&exclude=${l.id}&limit=4`).then(({ listings }) => {
      const box = $('#similar');
      if (box) box.innerHTML = listings.length ? listings.map(card).join('') : emptyBox('Benzer ilan yok', 'Bu kategoride başka ilan bulunmuyor.');
    }).catch(() => {});
  } catch (e) { pageError(e); }
}

function ownerActions(l) {
  const until = l.featured && !l.isSample ? `<p class="fine">${ic('star')} Vitrinde: ${dateFmt(l.featuredUntil)} tarihine kadar</p>` : '';
  return `<div class="side-actions">
    <span class="status ${l.status}" style="justify-self:start">${STATUS[l.status]}</span>
    ${l.status === 'approved' ? `<button class="btn gold lg block" data-feature="${l.id}">${ic('bolt')} ${l.featured ? 'Vitrin süresini uzat' : 'Vitrinde öne çıkar'} · ${state.config.costs.feature} kredi</button>` : ''}
    ${until}
    <button class="btn danger block" data-remove="${l.id}">${ic('trash')} İlanı kaldır</button>
  </div>`;
}

/* ================= ilan ver ================= */

function newListingPage() {
  const { costs } = state.config;
  const enough = state.balance >= costs.listing;
  setPage(shell(`${crumbs([['İlan ver']])}
    <div class="page-head"><div><div class="eyebrow">YENİ İLAN</div><h1>Dostunuz için ilan oluşturun</h1><p>İlanınız yönetici onayından sonra yayına alınır. Reddedilirse krediniz iade edilir.</p></div></div>
    ${enough ? '' : `<div class="notice warn">${ic('coin')}<span>İlan vermek için <b>${costs.listing} kredi</b> gerekiyor; bakiyeniz <b>${num(state.balance)}</b>. Formu doldurabilir, göndermeden önce <a class="link" href="#/krediler">kredi yükleyebilirsiniz</a>.</span></div>`}
    <form class="layout-2" id="listing-form">
      <div class="panel form">
        <div class="lbl">Kategori
          <div class="choice">${Object.entries(CATS).map(([k, c], i) => `<label><input type="radio" name="category" value="${k}" ${i === 0 ? 'checked' : ''}><span>${ic(c.icon)}${c.label}</span></label>`).join('')}</div>
        </div>
        <label>İlan başlığı<input name="title" required minlength="5" maxlength="90" placeholder="Örn. Sevimli Golden yavrusu yuva arıyor"></label>
        <div class="two">
          <label>Tür<select name="animal">${Object.entries(ANIMALS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label>Irk<input name="breed" required maxlength="50" placeholder="Örn. Golden Retriever / Melez"></label>
        </div>
        <div class="two">
          <label>Şehir<select name="city" required><option value="">Şehir seçin</option>${CITIES.map(c => `<option>${c}</option>`).join('')}</select></label>
          <label>Yaş<input name="age" maxlength="30" placeholder="Örn. 3 aylık"></label>
        </div>
        <label>Cinsiyet<select name="sex"><option value="">Belirtilmemiş</option><option>Dişi</option><option>Erkek</option></select></label>
        <label>Açıklama <span class="hint">Karakteri, sağlık ve aşı durumu, sahiplendirme koşulları… (en az 20 karakter)</span>
          <textarea name="description" required minlength="20" maxlength="3000" rows="6"></textarea><span class="hint" id="desc-count">0 / 3000</span></label>
        <div class="lbl">Fotoğraf <span class="hint">JPG, PNG ya da WEBP. Fotoğraf yüklenmeden önce küçültülür ve konum gibi ek bilgiler temizlenir.</span>
          <div class="upload" id="upload"><input type="file" name="photo" accept="image/jpeg,image/png,image/webp" aria-label="Fotoğraf seç"><div>${ic('camera')}<b>Fotoğraf seçin</b><br><small>ya da buraya sürükleyin</small></div></div>
        </div>
      </div>
      <aside class="sticky">
        <div class="panel">
          <h3 style="margin-bottom:16px">Özet</h3>
          <div class="pay-summary" style="margin:0 0 18px">
            <div><span>İlan ücreti</span><b>${costs.listing} kredi</b></div>
            <div><span>Mevcut bakiye</span><b>${num(state.balance)} kredi</b></div>
            <div class="total"><span>İşlem sonrası</span><span>${num(state.balance - costs.listing)} kredi</span></div>
          </div>
          <div class="form-error" id="listing-error" role="alert"></div>
          <button class="btn lg block" type="submit" ${enough ? '' : 'disabled'}>${ic('check')} Onaya gönder</button>
          ${enough ? '' : `<a class="btn lime lg block" href="#/krediler" style="margin-top:10px">${ic('coin')} Kredi yükle</a>`}
          <div class="safety">
            <div>${ic('clock')}<span>Onay süreci genellikle kısa sürer; durumu “Hesabım”dan izleyebilirsiniz.</span></div>
            <div>${ic('bolt')}<span>Yayına girdikten sonra ${state.config.costs.feature} krediyle vitrine taşıyabilirsiniz.</span></div>
          </div>
        </div>
      </aside>
    </form>`));

  const form = $('#listing-form');
  let photo = null;
  form.description.oninput = () => ($('#desc-count').textContent = `${form.description.value.length} / 3000`);
  form.photo.onchange = async () => {
    const file = form.photo.files[0];
    if (!file) return;
    try {
      photo = await resizeImage(file);
      const box = $('#upload');
      box.querySelector('img')?.remove();
      const img = new Image();
      img.src = photo;
      img.alt = 'Seçilen fotoğraf önizlemesi';
      box.append(img);
    } catch (e) {
      photo = null;
      form.photo.value = '';
      toast(e.message, 'error');
    }
  };
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = $('button[type="submit"]', form);
    const err = $('#listing-error');
    err.classList.remove('show');
    busy(btn, true);
    const fd = new FormData(form);
    try {
      const res = await api('/api/listings', {
        method: 'POST',
        body: { ...Object.fromEntries(['category', 'title', 'animal', 'breed', 'city', 'age', 'sex', 'description'].map(k => [k, fd.get(k)])), photo },
      });
      setBalance(res.balance);
      toast('İlanınız onaya gönderildi. Onaylandığında yayına girecek.');
      location.hash = '#/hesabim';
    } catch (ex) {
      err.innerHTML = esc(ex.message) + (ex.status === 402 ? ' <a class="link" href="#/krediler">Kredi yükle →</a>' : '');
      err.classList.add('show');
      busy(btn, false);
    }
  };
}

async function resizeImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Lütfen JPG, PNG ya da WEBP bir fotoğraf seçin.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Fotoğraf 20 MB’tan büyük olamaz.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('Fotoğraf okunamadı.'); }
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/* ================= hesabım ================= */

async function accountPage() {
  loading();
  try {
    const [mine, ledger, res, all] = await Promise.all([
      api('/api/me/listings'), api('/api/me/ledger'), api('/api/me/reservations'),
      state.favorites.length ? api('/api/listings?limit=100') : Promise.resolve({ listings: [] }),
    ]);
    setBalance(ledger.balance);
    const u = state.user;
    const live = mine.listings.filter(l => l.status === 'approved').length;
    const pending = mine.listings.filter(l => l.status === 'pending').length;
    const favs = all.listings.filter(l => state.favorites.includes(l.id));
    setPage(shell(`${crumbs([['Hesabım']])}
      <div class="page-head">
        <div><div class="eyebrow">HESABIM</div><h1>Merhaba, ${esc(firstName(u.name))}</h1><p>${esc(u.email)} · Üyelik: ${dateFmt(u.createdAt)}</p></div>
        <div class="row-gap"><a class="btn outline" href="#/krediler">${ic('coin')} Kredi yükle</a><a class="btn" href="#/ilan-ver">${ic('plus')} Yeni ilan</a>${u.role === 'admin' ? `<a class="btn lime" href="#/yonetim">${ic('grid')} Yönetim</a>` : ''}</div>
      </div>
      <div class="stat-grid">
        <div class="stat dark"><small>${ic('coin')} Kredi bakiyesi</small><b>${num(ledger.balance)}</b><em><a class="link" style="color:var(--lime)" href="#/krediler">Kredi yükle →</a></em></div>
        <div class="stat"><small>${ic('check')} Yayındaki ilan</small><b>${live}</b><em>aktif</em></div>
        <div class="stat"><small>${ic('clock')} Onay bekleyen</small><b>${pending}</b><em>ilan</em></div>
        <div class="stat"><small>${ic('heart')} Favoriler</small><b>${favs.length}</b><em>kayıtlı dost</em></div>
      </div>
      <div class="panel"><div class="panel-head"><h3>İlanlarım</h3><a class="btn sm outline" href="#/ilan-ver">${ic('plus')} Yeni ilan</a></div>
        ${mine.listings.length ? `<div class="my-list">${mine.listings.map(myItem).join('')}</div>` : emptyBox('Henüz ilanınız yok', `İlk ilanınızı ${state.config.costs.listing} krediyle oluşturabilirsiniz.`, `<br><a class="btn sm" href="#/ilan-ver" style="margin-top:14px">${ic('plus')} İlan ver</a>`)}
      </div>
      <div class="layout-2" style="margin-top:20px;grid-template-columns:1.3fr 1fr">
        <div class="panel"><div class="panel-head"><h3>Son kredi hareketleri</h3><a class="link" href="#/krediler">Tümü</a></div>${ledgerTable(ledger.entries.slice(0, 8))}</div>
        <div class="panel"><div class="panel-head"><h3>Taleplerim</h3><button class="btn sm outline" data-action="visit">${ic('calendar')} Ziyaret planla</button></div>
          ${res.reservations.length ? `<div class="my-list">${res.reservations.map(r => `<div class="my-item" style="grid-template-columns:1fr auto"><div><h4>${esc(r.topic)}</h4><small>${dateFmt(r.createdAt)}${r.date ? ' · Tercih: ' + esc(r.date) : ''}</small></div><span class="status ${r.status}">${STATUS[r.status]}</span></div>`).join('')}</div>` : emptyBox('Talep yok', 'Ziyaret ve tanışma talepleriniz burada görünür.')}
        </div>
      </div>
      <section class="section"><div class="section-head"><div><div class="eyebrow">FAVORİLERİM</div><h2>Kaydettiğiniz dostlar</h2></div></div>
        <div class="grid">${favs.length ? favs.map(card).join('') : emptyBox('Henüz favoriniz yok', 'İlanlardaki kalp simgesine dokunarak dostları kaydedebilirsiniz.')}</div></section>`));
  } catch (e) { pageError(e); }
}

function myItem(l) {
  return `<div class="my-item">
    ${l.photo ? `<img class="thumb" src="${esc(l.photo)}" alt="">` : `<span class="thumb">${ic('paw')}</span>`}
    <div><h4>${esc(l.title)}</h4>
      <small>${CATS[l.category]?.label} · ${esc(l.city)} · ${dateFmt(l.createdAt)}</small>
      <div class="row-gap" style="margin-top:6px;gap:6px"><span class="status ${l.status}">${STATUS[l.status]}</span>${l.featured ? `<span class="status featured">Vitrinde · ${dateFmt(l.featuredUntil)}</span>` : ''}</div>
      ${l.status === 'rejected' && l.rejectReason ? `<small class="reason">Ret gerekçesi: ${esc(l.rejectReason)} (kredi iade edildi)</small>` : ''}
    </div>
    <div class="acts">
      <a class="btn sm outline" href="#/ilan/${l.id}">${ic('eye')} Görüntüle</a>
      ${l.status === 'approved' ? `<button class="btn sm gold" data-feature="${l.id}">${ic('bolt')} Öne çıkar</button>` : ''}
      <button class="btn sm danger" data-remove="${l.id}" aria-label="İlanı kaldır">${ic('trash')}</button>
    </div>
  </div>`;
}

async function featureListing(id, btn) {
  const { costs, featureDays } = state.config;
  if (state.balance < costs.feature) {
    toast(`Öne çıkarmak için ${costs.feature} kredi gerekiyor.`, 'error');
    return (location.hash = '#/krediler');
  }
  const ok = await confirmModal({ title: 'Vitrinde öne çıkar', text: `İlanınız ${featureDays} gün boyunca listelerin en üstünde, vitrin rozetiyle gösterilecek. Hesabınızdan <b>${costs.feature} kredi</b> düşülecek. (Bakiye: ${num(state.balance)})`, ok: `${costs.feature} kredi kullan` });
  if (!ok) return;
  busy(btn, true);
  try {
    const res = await api(`/api/listings/${id}/feature`, { method: 'POST', body: { idempotencyKey: uid() } });
    setBalance(res.balance);
    toast('İlanınız vitrine taşındı.');
    router();
  } catch (e) {
    toast(e.message, 'error');
    busy(btn, false);
  }
}

async function removeListing(id) {
  const ok = await confirmModal({ title: 'İlanı kaldır', text: 'İlan yayından kaldırılacak. Bu işlem geri alınamaz ve kullanılan kredi iade edilmez.', ok: 'Kaldır', danger: true });
  if (!ok) return;
  try {
    await api(`/api/listings/${id}`, { method: 'DELETE' });
    toast('İlan kaldırıldı.');
    if (location.hash.startsWith('#/ilan/')) location.hash = '#/hesabim';
    else router();
  } catch (e) { toast(e.message, 'error'); }
}

/* ================= talep / iletişim ================= */

function requestForm({ title, topic, listingId = null, withDate = false, intro }) {
  const u = state.user;
  openModal(`<div class="eyebrow">${withDate ? 'RANDEVU' : 'İLETİŞİM'}</div><h2 id="modal-title">${esc(title)}</h2><p>${esc(intro)}</p>
    <form class="form" id="request-form">
      <div class="two"><label>Ad soyad<input name="name" required minlength="2" maxlength="80" autocomplete="name" value="${esc(u?.name || '')}"></label>
      <label>E-posta<input name="email" type="email" required maxlength="120" autocomplete="email" value="${esc(u?.email || '')}"></label></div>
      <div class="two"><label>Telefon <span class="hint">(isteğe bağlı)</span><input name="phone" type="tel" maxlength="25" autocomplete="tel" placeholder="05xx xxx xx xx"></label>
      ${withDate ? `<label>Tercih ettiğiniz tarih<input name="date" type="date" required min="${new Date().toISOString().slice(0, 10)}"></label>` : `<label>Konu<input name="topic" required maxlength="120" value="${esc(topic)}"></label>`}</div>
      <label>Mesajınız<textarea name="message" required minlength="5" maxlength="2000" rows="4" placeholder="${withDate ? 'Kaç kişi geleceğinizi ve ilgilendiğiniz dostları yazabilirsiniz.' : 'Mesajınızı yazın…'}"></textarea></label>
      <div class="form-error" id="request-error" role="alert"></div>
      <button class="btn lg" type="submit">${ic('right')} Gönder</button>
    </form>`);
  const form = $('#request-form');
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = $('button[type="submit"]', form);
    busy(btn, true);
    const fd = new FormData(form);
    try {
      await api('/api/reservations', { method: 'POST', body: { name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'), topic: fd.get('topic') || topic, date: fd.get('date') || null, message: fd.get('message'), listingId } });
      closeModal();
      toast('Talebiniz alındı. En kısa sürede size dönüş yapılacak.');
      if (location.hash === '#/hesabim') accountPage();
    } catch (ex) {
      const err = $('#request-error');
      err.textContent = ex.message;
      err.classList.add('show');
      busy(btn, false);
    }
  };
}

/* ================= yönetim ================= */

const adminState = { tab: 'pending' };

async function adminPage() {
  loading();
  try {
    const [s, ls, rs, us] = await Promise.all([
      api('/api/admin/stats'), api('/api/admin/listings?status=' + adminState.tab), api('/api/admin/reservations'), api('/api/admin/users'),
    ]);
    const max = Math.max(1, ...s.series.map(d => d.amount));
    const tabs = [['pending', 'Onay bekleyen'], ['approved', 'Yayında'], ['rejected', 'Reddedilen'], ['all', 'Tümü']];
    setPage(shell(`${crumbs([['Yönetim paneli']])}
      <div class="page-head"><div><div class="eyebrow">YÖNETİM</div><h1>Yönetim paneli</h1><p>Satışlar, ilan onayları, talepler ve kullanıcılar.</p></div><button class="btn outline" data-action="admin-refresh">${ic('clock')} Yenile</button></div>
      <div class="stat-grid">
        <div class="stat dark"><small>${ic('coin')} Bugünkü satış</small><b>${money(s.todaySales)}</b><em>${s.todayOrders} sipariş · toplam ${money(s.totalSales)}</em></div>
        <div class="stat"><small>${ic('clock')} Onay bekleyen ilan</small><b>${s.pendingListings}</b><em>${s.liveListings} ilan yayında</em></div>
        <div class="stat"><small>${ic('calendar')} Yeni talepler</small><b>${s.newReservations}</b><em>yanıt bekliyor</em></div>
        <div class="stat"><small>${ic('user')} Kullanıcılar</small><b>${num(s.users)}</b><em>bugün +${s.usersToday} · bugün ${num(s.creditsSpentToday)} kredi harcandı</em></div>
      </div>
      <div class="layout-2" style="grid-template-columns:1fr 1fr;margin-bottom:20px">
        <div class="panel"><div class="panel-head"><h3>Son 7 gün satış</h3><small class="fine" style="margin:0">${state.config.paymentMode === 'test' ? 'Test ödemeleri dahil' : ''}</small></div>
          <div class="bars">${s.series.map((d, i) => `<div class="bar ${i === 6 ? 'today' : ''}" title="${d.orders} sipariş"><b>${d.amount ? money(d.amount) : ''}</b><i style="height:${Math.round((d.amount / max) * 100)}%"></i><span>${new Date(d.day + 'T12:00:00').toLocaleDateString('tr-TR', { weekday: 'short' })}</span></div>`).join('')}</div>
        </div>
        <div class="panel"><div class="panel-head"><h3>Son siparişler</h3></div>
          ${s.recentOrders.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Üye</th><th>Kredi</th><th>Tutar</th><th>Durum</th></tr></thead><tbody>${s.recentOrders.map(o => `<tr><td>${o.id}</td><td>${esc(o.name)}<br><small class="fine" style="margin:0">${dateTimeFmt(o.createdAt)}</small></td><td>${o.credits}</td><td>${money(o.amount)}</td><td><span class="status ${o.status}">${STATUS[o.status]}</span></td></tr>`).join('')}</tbody></table></div>` : emptyBox('Sipariş yok', 'Kredi satışları burada listelenir.')}
        </div>
      </div>
      <div class="panel"><div class="panel-head"><h3>İlanlar</h3></div>
        <div class="tabs">${tabs.map(([k, t]) => `<button class="tab ${adminState.tab === k ? 'active' : ''}" data-admin-tab="${k}">${t}</button>`).join('')}</div>
        ${ls.listings.length ? `<div class="my-list">${ls.listings.map(adminItem).join('')}</div>` : emptyBox('Kayıt yok', adminState.tab === 'pending' ? 'Onay bekleyen ilan bulunmuyor. 🎉' : 'Bu durumda ilan bulunmuyor.')}
      </div>
      <div class="panel"><div class="panel-head"><h3>Rezervasyon ve talepler</h3></div>
        ${rs.reservations.length ? `<div class="table-wrap"><table><thead><tr><th>Tarih</th><th>Kişi</th><th>Konu</th><th>Mesaj</th><th>Durum</th></tr></thead><tbody>${rs.reservations.map(r => `<tr>
          <td>${dateTimeFmt(r.createdAt)}${r.date ? `<br><small class="fine" style="margin:0">Tercih: ${esc(r.date)}</small>` : ''}</td>
          <td><b>${esc(r.name)}</b><br><small>${esc(r.email)}${r.phone ? ' · ' + esc(r.phone) : ''}</small></td>
          <td>${r.listingId ? `<a class="link" href="#/ilan/${r.listingId}">${esc(r.topic)}</a>` : esc(r.topic)}</td>
          <td style="max-width:280px">${esc(r.message)}</td>
          <td><select data-res-status="${r.id}" aria-label="Talep durumu">${['new', 'confirmed', 'cancelled'].map(k => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${STATUS[k]}</option>`).join('')}</select></td>
        </tr>`).join('')}</tbody></table></div>` : emptyBox('Talep yok', 'Ziyaret ve iletişim talepleri burada listelenir.')}
      </div>
      <div class="panel"><div class="panel-head"><h3>Kullanıcılar</h3></div>
        <div class="table-wrap"><table><thead><tr><th>Ad</th><th>E-posta</th><th>Rol</th><th>Kredi</th><th>İlan</th><th>Kayıt</th></tr></thead><tbody>${us.users.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>${x.role === 'admin' ? '<span class="status approved">Yönetici</span>' : 'Üye'}</td><td>${num(x.balance)}</td><td>${x.listings}</td><td>${dateFmt(x.createdAt)}</td></tr>`).join('')}</tbody></table></div>
      </div>`));
  } catch (e) { pageError(e); }
}

function adminItem(l) {
  return `<div class="my-item">
    ${l.photo ? `<img class="thumb" src="${esc(l.photo)}" alt="">` : `<span class="thumb">${ic('paw')}</span>`}
    <div><h4>${esc(l.title)}</h4>
      <small>${CATS[l.category]?.label} · ${esc(l.breed)} · ${esc(l.city)} · ${l.isSample ? 'Örnek ilan' : `${esc(l.ownerName || '')} &lt;${esc(l.ownerEmail || '')}&gt;`} · ${dateTimeFmt(l.createdAt)}</small>
      <div class="row-gap" style="margin-top:6px;gap:6px"><span class="status ${l.status}">${STATUS[l.status]}</span>${l.featured ? '<span class="status featured">Vitrinde</span>' : ''}</div>
      ${l.rejectReason ? `<small class="reason">Gerekçe: ${esc(l.rejectReason)}</small>` : ''}
    </div>
    <div class="acts">
      <a class="btn sm outline" href="#/ilan/${l.id}">${ic('eye')} İncele</a>
      ${l.status === 'pending' ? `<button class="btn sm" data-approve="${l.id}">${ic('check')} Onayla</button><button class="btn sm danger" data-reject="${l.id}">${ic('close')} Reddet</button>` : ''}
      ${l.status === 'approved' ? `<button class="btn sm danger" data-remove="${l.id}" aria-label="Yayından kaldır">${ic('trash')}</button>` : ''}
    </div>
  </div>`;
}

function rejectListing(id) {
  openModal(`<h2 id="modal-title">İlanı reddet</h2><p>Gerekçe ilan sahibine gösterilir ve kullanılan kredi otomatik olarak iade edilir.</p>
    <form class="form" id="reject-form"><label>Ret gerekçesi<textarea name="reason" required minlength="3" maxlength="300" rows="3" placeholder="Örn. Fotoğraf ilanla uyumlu değil."></textarea></label>
    <div class="row-gap"><button class="btn danger" type="submit">Reddet ve krediyi iade et</button><button class="btn outline" type="button" id="reject-cancel">Vazgeç</button></div></form>`);
  $('#reject-cancel').onclick = closeModal;
  $('#reject-form').onsubmit = async e => {
    e.preventDefault();
    const btn = $('button[type="submit"]', e.target);
    busy(btn, true);
    try {
      const res = await api(`/api/admin/listings/${id}/reject`, { method: 'POST', body: { reason: e.target.reason.value } });
      closeModal();
      toast(`İlan reddedildi${res.refunded ? `, ${res.refunded} kredi iade edildi` : ''}.`);
      adminPage();
    } catch (ex) {
      toast(ex.message, 'error');
      busy(btn, false);
    }
  };
}

/* ================= bilgi pencereleri ================= */

const INFO = {
  privacy: `<h2 id="modal-title">Gizlilik bilgilendirmesi</h2>
    <p>Hesap bilgileriniz (ad, e-posta), ilanlarınız, kredi hareketleriniz ve gönderdiğiniz talepler hizmetin sunulması amacıyla sunucuda saklanır. Şifreniz geri döndürülemez biçimde şifrelenerek tutulur. Favorileriniz yalnızca bu tarayıcıda saklanır.</p>
    <p>Yüklenen fotoğraflar yüklenmeden önce yeniden işlenir; konum gibi ek bilgiler fotoğrafa eklenmez. Kart bilgisi uygulamada istenmez ve saklanmaz.</p>
    <div class="notice warn">${ic('book')}<span>Taslak metin: Yayına almadan önce veri sorumlusu bilgileri ve KVKK aydınlatma metni proje sahibi tarafından tamamlanmalıdır.</span></div>
    <button class="btn outline" id="clear-local">Bu tarayıcıdaki favorileri temizle</button>`,
  terms: `<h2 id="modal-title">Kullanım koşulları</h2>
    <p>İlanlar yönetici onayından sonra yayınlanır. Hayvan refahına aykırı, yanıltıcı ya da satış amaçlı ilanlar reddedilir; reddedilen ilanların kredisi iade edilir. Öne çıkarma süresi 7 gündür ve kullanılan krediler iade edilmez.</p>
    <p>“Örnek ilan” etiketli kayıtlar tasarımı göstermek içindir. Ödeme sağlayıcısı bağlanana kadar kredi alımları test modunda çalışır ve gerçek tahsilat yapılmaz.</p>
    <div class="notice warn">${ic('book')}<span>Taslak metin: Nihai kullanım koşulları proje sahibi tarafından hazırlanmalıdır.</span></div>`,
};

/* ================= olaylar ================= */

document.addEventListener('click', async e => {
  const t = e.target;

  if (t.closest('#avatar')) {
    const dd = $('#dropdown');
    const open = dd.hasAttribute('hidden');
    dd.toggleAttribute('hidden', !open);
    $('#avatar').setAttribute('aria-expanded', String(open));
    return;
  }
  if (!t.closest('#dropdown')) $('#dropdown')?.setAttribute('hidden', '');
  if (t.closest('#menu-toggle')) {
    const open = $('#main-nav').classList.toggle('open');
    $('#menu-toggle').setAttribute('aria-expanded', String(open));
    return;
  }
  if (t.closest('#main-nav a')) closeMenus();

  const fav = t.closest('[data-fav]');
  if (fav) {
    e.stopPropagation();
    const id = Number(fav.dataset.fav);
    const saved = toggleFavorite(id);
    fav.classList.toggle('saved', saved);
    fav.setAttribute('aria-pressed', String(saved));
    fav.setAttribute('aria-label', saved ? 'Favorilerden çıkar' : 'Favorilere ekle');
    toast(saved ? 'Favorilerinize eklendi.' : 'Favorilerden çıkarıldı.');
    if (!saved && state.category === 'favorites' && !$('#home').hidden) loadListings();
    return;
  }
  const favDetail = t.closest('[data-fav-detail]');
  if (favDetail) {
    const saved = toggleFavorite(Number(favDetail.dataset.favDetail));
    favDetail.querySelector('span').textContent = saved ? 'Favorilerden çıkar' : 'Favorilere ekle';
    toast(saved ? 'Favorilerinize eklendi.' : 'Favorilerden çıkarıldı.');
    return;
  }

  const go = t.closest('[data-href]');
  if (go && !t.closest('a, button')) { location.hash = go.dataset.href; return; }

  const el = t.closest('[data-action],[data-buy],[data-cat],[data-category],[data-breed],[data-breed-search],[data-feature],[data-remove],[data-approve],[data-reject],[data-admin-tab],#clear-local');
  if (!el) return;
  const d = el.dataset;

  if (d.buy) return startCheckout(d.buy, el);
  if (d.category) return setCategory(d.category);
  if (d.cat) { setCategory(d.cat); return $('#ilanlar').scrollIntoView({ behavior: 'smooth' }); }
  if (d.breed) return showBreed(Number(d.breed));
  if (d.breedSearch) {
    closeModal();
    $('#f-q').value = d.breedSearch;
    $('#f-breed').value = 'all';
    setCategory('all');
    return $('#ilanlar').scrollIntoView({ behavior: 'smooth' });
  }
  if (d.feature) return featureListing(Number(d.feature), el);
  if (d.remove) return removeListing(Number(d.remove));
  if (d.adminTab) { adminState.tab = d.adminTab; return adminPage(); }
  if (d.approve) {
    busy(el, true);
    try {
      await api(`/api/admin/listings/${d.approve}/approve`, { method: 'POST' });
      toast('İlan onaylandı ve yayına alındı.');
      adminPage();
    } catch (ex) { toast(ex.message, 'error'); busy(el, false); }
    return;
  }
  if (d.reject) return rejectListing(Number(d.reject));
  if (el.id === 'clear-local') {
    try { localStorage.removeItem('pati-favorites'); localStorage.removeItem('pati-pending'); } catch { /* yok say */ }
    state.favorites = [];
    closeModal();
    toast('Bu tarayıcıdaki favoriler temizlendi.');
    return loadListings();
  }

  switch (d.action) {
    case 'logout': return logout();
    case 'visit': return requestForm({ title: 'Çiftlik ziyareti planlayın', topic: 'Çiftlik ziyareti', withDate: true, intro: 'Ziyaretler randevuyla yapılır. Tercih ettiğiniz tarihi iletin, uygunluk durumunu size bildirelim.' });
    case 'contact': return requestForm({ title: 'Bize yazın', topic: 'Genel soru', intro: 'Sorularınızı, önerilerinizi ya da iş birliği taleplerinizi iletebilirsiniz.' });
    case 'inquire': return requestForm({ title: 'Tanışma talebi', topic: `İlan #${d.id}: ${d.title}`.slice(0, 120), listingId: Number(d.id), intro: 'Talebiniz ilan sahibine iletilmek üzere kaydedilir. Kendinizden ve yaşam alanınızdan kısaca bahsedin.' });
    case 'share':
      try { await navigator.clipboard.writeText(location.href); toast('Bağlantı kopyalandı.'); } catch { toast('Bağlantı kopyalanamadı.', 'error'); }
      return;
    case 'privacy': case 'terms': return openModal(INFO[d.action]);
    case 'reset-filters':
      $('#f-q').value = '';
      ['f-animal', 'f-breed', 'f-city'].forEach(id => ($('#' + id).value = 'all'));
      return setCategory('all');
    case 'admin-refresh': return adminPage();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches?.('.card[data-href]')) location.hash = e.target.dataset.href;
  if (e.key === 'Escape') closeMenus();
});

document.addEventListener('change', async e => {
  const sel = e.target.closest('[data-res-status]');
  if (!sel) return;
  try {
    await api(`/api/admin/reservations/${sel.dataset.resStatus}/status`, { method: 'POST', body: { status: sel.value } });
    toast('Talep durumu güncellendi.');
  } catch (ex) { toast(ex.message, 'error'); }
});

$('#search').addEventListener('submit', e => {
  e.preventDefault();
  if (state.category === 'favorites') setCategory('all');
  else loadListings();
  $('#ilanlar').scrollIntoView({ behavior: 'smooth' });
});
['f-animal', 'f-breed', 'f-city'].forEach(id => $('#' + id).addEventListener('change', loadListings));

for (const group of ['v-species', 'v-stage']) {
  $('#' + group).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('button', b.parentElement).forEach(x => x.classList.toggle('active', x === b));
    vaccineState[group === 'v-species' ? 'species' : 'stage'] = b.dataset.v;
    renderVaccine();
  });
}

const header = $('.site-header');
addEventListener('scroll', () => header.classList.toggle('scrolled', scrollY > 10), { passive: true });
addEventListener('hashchange', router);

/* ================= başlangıç ================= */

(async function init() {
  renderBreeds();
  renderVaccine();
  try {
    const [config, me] = await Promise.all([api('/api/config'), api('/api/auth/me')]);
    state.config = config;
    setAccount(me);
  } catch (e) {
    toast(e.message, 'error');
  }
  renderHeader();
  renderPricing();
  router();
})();
