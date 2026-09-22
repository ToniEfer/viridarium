/* ============================================================
   app.js — aparat, zielnik, arkusz wyniku
   ============================================================ */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const el = {
  intro: $('#intro'), introNote: $('#intro-note'),
  camera: $('#camera'), video: $('#video'), hint: $('#hint'),
  analyze: $('#btn-analyze'), flip: $('#btn-flip'),
  fileInput: $('#file-input'),
  sheetWrap: $('#sheet-wrap'), sheetScroll: $('#sheet-scroll'),
  herbarium: $('#herbarium'), herbGrid: $('#herb-grid'), herbEmpty: $('#herb-empty'), herbCount: $('#herb-count'),
  settings: $('#settings'), apikey: $('#apikey'), model: $('#model'), providerHelp: $('#provider-help'),
  busy: $('#busy'), busyImg: $('#busy-img'), busyStep: $('#busy-step'),
  toast: $('#toast')
};

const USTAWIENIA_KLUCZ = 'viridarium.ustawienia';
let ustawienia = { provider: 'gemini', apiKey: '', model: '' };
let strumien = null;
let kamera = 'environment';
let ostatniOkaz = null;

/* ---------------- ustawienia ---------------- */

function wczytajUstawienia(){
  try{
    const zapisane = JSON.parse(localStorage.getItem(USTAWIENIA_KLUCZ) || '{}');
    ustawienia = { ...ustawienia, ...zapisane };
  }catch{ /* pierwsze uruchomienie */ }
  $$('input[name="provider"]').forEach(i => { i.checked = i.value === ustawienia.provider; });
  el.apikey.value = ustawienia.apiKey || '';
  el.model.value = ustawienia.model || '';
  el.model.placeholder = PROVIDERS[ustawienia.provider].model;
  el.providerHelp.textContent = PROVIDERS[ustawienia.provider].skad;
}

function zapiszUstawienia(){
  ustawienia.provider = $('input[name="provider"]:checked')?.value || 'gemini';
  ustawienia.apiKey = el.apikey.value.trim();
  ustawienia.model = el.model.value.trim();
  el.model.placeholder = PROVIDERS[ustawienia.provider].model;
  el.providerHelp.textContent = PROVIDERS[ustawienia.provider].skad;
  try{ localStorage.setItem(USTAWIENIA_KLUCZ, JSON.stringify(ustawienia)); }catch{ /* tryb prywatny */ }
}

/* ---------------- baza okazów ---------------- */

let baza = null;
function otworzBaze(){
  if(baza) return baza;
  baza = new Promise((ok, err) => {
    const req = indexedDB.open('viridarium', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('okazy', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => err(req.error);
  });
  return baza;
}

async function transakcja(tryb, fn){
  const db = await otworzBaze();
  return new Promise((ok, err) => {
    const t = db.transaction('okazy', tryb);
    const r = fn(t.objectStore('okazy'));
    t.oncomplete = () => ok(r.result);
    t.onerror = () => err(t.error);
  });
}

const dodajOkaz   = o => transakcja('readwrite', s => s.add(o));
const usunOkaz    = id => transakcja('readwrite', s => s.delete(id));
const wszystkieOkazy = () => transakcja('readonly', s => s.getAll());
const wyczyscOkazy = () => transakcja('readwrite', s => s.clear());

/* ---------------- aparat ---------------- */

async function wlaczKamere(){
  if(!navigator.mediaDevices?.getUserMedia){
    el.introNote.textContent = 'Ta przeglądarka nie udostępnia aparatu. Użyj zdjęcia z galerii.';
    return false;
  }
  if(!window.isSecureContext){
    el.introNote.textContent = 'Aparat działa tylko przez HTTPS lub na localhost. Patrz README. Zdjęcie z galerii działa zawsze.';
    return false;
  }
  try{
    strumien?.getTracks().forEach(t => t.stop());
    strumien = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: kamera }, width: { ideal: 1920 }, height: { ideal: 1920 } },
      audio: false
    });
    el.video.srcObject = strumien;
    await el.video.play().catch(() => {});
    return true;
  }catch(e){
    el.introNote.textContent = e.name === 'NotAllowedError'
      ? 'Brak zgody na dostęp do aparatu. Zmień to w ustawieniach strony.'
      : 'Nie udało się uruchomić aparatu. Użyj zdjęcia z galerii.';
    return false;
  }
}

function pokazKamere(){
  el.intro.hidden = true;
  el.camera.hidden = false;
}

/* kadr z podglądu → JPEG o dłuższym boku 1280 px */
function zrobZdjecie(){
  const v = el.video;
  const w = v.videoWidth, h = v.videoHeight;
  if(!w || !h) throw new Error('Obraz z aparatu jeszcze się nie pojawił.');
  return skaluj(v, w, h);
}

function skaluj(zrodlo, w, h, max = 1280){
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d').drawImage(zrodlo, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

function miniatura(dataUrl){
  return new Promise(ok => {
    const img = new Image();
    img.onload = () => ok(skaluj(img, img.naturalWidth, img.naturalHeight, 420));
    img.src = dataUrl;
  });
}

function zPliku(plik){
  return new Promise((ok, err) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => ok(skaluj(img, img.naturalWidth, img.naturalHeight));
      img.onerror = () => err(new Error('Nie udało się otworzyć tego pliku.'));
      img.src = r.result;
    };
    r.onerror = () => err(new Error('Nie udało się odczytać pliku.'));
    r.readAsDataURL(plik);
  });
}

/* ---------------- analiza ---------------- */

const KROKI = ['Przygotowuję okaz', 'Porównuję cechy', 'Oznaczam gatunek', 'Spisuję arkusz'];

async function analizuj(dataUrl){
  if(!ustawienia.apiKey){
    otworzNakladke(el.settings);
    komunikat('Najpierw wklej klucz API.', true);
    return;
  }

  el.busyImg.src = dataUrl;
  el.busy.hidden = false;
  el.camera.classList.add('is-scanning');
  el.analyze.disabled = true;

  let krok = 0;
  el.busyStep.textContent = KROKI[0];
  const tyka = setInterval(() => {
    krok = Math.min(krok + 1, KROKI.length - 1);
    el.busyStep.textContent = KROKI[krok];
  }, 2200);

  try{
    const dane = await recognize({
      dataUrl,
      provider: ustawienia.provider,
      apiKey: ustawienia.apiKey,
      model: ustawienia.model
    });

    const okaz = {
      dane,
      zdjecie: dataUrl,
      mini: await miniatura(dataUrl),
      data: new Date().toISOString()
    };
    okaz.id = await dodajOkaz(okaz);
    ostatniOkaz = okaz;
    await odswiezLicznik();
    pokazArkusz(okaz);
  }catch(e){
    komunikat(e.message, true);
  }finally{
    clearInterval(tyka);
    el.busy.hidden = true;
    el.camera.classList.remove('is-scanning');
    el.analyze.disabled = false;
  }
}

/* ---------------- arkusz wyniku ---------------- */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

const dataPL = iso => new Date(iso).toLocaleDateString('pl-PL',
  { day:'2-digit', month:'2-digit', year:'numeric' });

function numerOkazu(id){ return String(id).padStart(3, '0'); }

function sekcja(etykieta, tresc){
  if(!tresc) return '';
  return `<section class="block"><h3 class="block__label">${esc(etykieta)}</h3>${tresc}</section>`;
}

function akapity(tekst){
  if(!tekst) return '';
  return String(tekst).split(/\n{2,}/).map(p => `<p>${esc(p)}</p>`).join('');
}

function lista(tablica){
  if(!Array.isArray(tablica) || !tablica.length) return '';
  return `<ul class="tags">${tablica.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

function arkuszHTML(okaz){
  const d = okaz.dane;
  const pewnosc = Math.max(0, Math.min(100, Number(d.pewnosc) || 0));
  const u = d.uprawa || {};
  const k = d.kondycja || {};
  const b = d.bezpieczenstwo || {};

  const wierszeUprawy = [
    ['Stanowisko',  u.stanowisko],
    ['Podlewanie',  u.podlewanie],
    ['Gleba',       u.gleba],
    ['Temperatura', u.temperatura],
    ['Rozmnażanie', u.rozmnazanie],
    ['Trudność',    u.trudnosc]
  ].filter(([, v]) => v)
   .map(([kl, v]) => `<dt>${kl}</dt><dd>${esc(v)}</dd>`).join('');

  const alternatywy = Array.isArray(d.alternatywy) && d.alternatywy.length
    ? `<ul class="alts">${d.alternatywy.slice(0,4).map(a => `
        <li><span>${esc(a.nazwa_pl || '—')} <em>${esc(a.nazwa_lat || '')}</em></span><b>${Math.round(Number(a.pewnosc)||0)}%</b></li>
      `).join('')}</ul>`
    : '';

  const ocena = String(k.ocena || 'dobra').toLowerCase();
  const etykietaOceny = { dobra:'Wygląda zdrowo', sygnaly:'Widoczne sygnały', zla:'Wyraźne objawy' }[ocena] || 'Ocena';
  const kondycja = `
    <p class="verdict verdict--${esc(ocena)}">${esc(etykietaOceny)}</p>
    ${akapity((k.obserwacje || []).join('\n\n'))}
    ${(k.zalecenia || []).length ? `<h4 class="block__label" style="margin-top:14px">Co zrobić</h4>${lista(k.zalecenia)}` : ''}`;

  const ostrzezenie = (b.toksycznosc || b.ostrzezenie)
    ? `<aside class="warn"><strong>Bezpieczeństwo</strong>${esc([b.toksycznosc, b.ostrzezenie].filter(Boolean).join(' '))}</aside>`
    : '';

  return `
  <div class="rec">
    <div class="rec__meta">
      <span class="rec__no">OKAZ № ${numerOkazu(okaz.id)}</span>
      <span class="sp">${esc(dataPL(okaz.data))}</span>
    </div>

    <figure class="rec__plate"><img src="${okaz.zdjecie}" alt="Zdjęcie oznaczanej rośliny"></figure>

    <header class="rec__names">
      <h2 class="rec__pl" id="s-name-pl">${esc(d.nazwa_pl || 'Nieoznaczony')}</h2>
      ${d.nazwa_lat ? `<p class="rec__lat">${esc(d.nazwa_lat)}</p>` : ''}
      ${d.rodzina ? `<p class="rec__fam">rodzina ${esc(d.rodzina)}</p>` : ''}
    </header>

    <div class="conf">
      <div class="conf__top"><span>Pewność oznaczenia</span><span class="conf__val">${pewnosc}%</span></div>
      <div class="conf__bar${pewnosc < 60 ? ' is-low' : ''}"><i style="width:${pewnosc}%"></i></div>
      <div class="conf__ticks"><span>0</span><span>50</span><span>100</span></div>
    </div>

    ${sekcja('Opis', akapity(d.opis))}
    ${sekcja('Występowanie', akapity(d.wystepowanie))}
    ${wierszeUprawy ? sekcja('Uprawa', `<dl class="spec">${wierszeUprawy}</dl>`) : ''}
    ${sekcja('Kondycja', kondycja)}
    ${alternatywy ? sekcja('Gatunki podobne', alternatywy) : ''}
    ${d.ciekawostka ? sekcja('Notatka', akapity(d.ciekawostka)) : ''}
    ${ostrzezenie}

    <div class="sheet__actions">
      <button class="btn btn--sheet" data-close-sheet>Gotowe</button>
      <button class="btn btn--sheet-2" data-usun="${okaz.id}">Usuń okaz</button>
    </div>

    <p class="fineprint">Oznaczenie i opis pochodzą z modelu AI i mogą być błędne. Nie decyduj o spożyciu ani zastosowaniu leczniczym rośliny na podstawie tej aplikacji.</p>
  </div>`;
}

function pokazArkusz(okaz){
  ostatniOkaz = okaz;
  el.sheetScroll.innerHTML = arkuszHTML(okaz);
  el.sheetScroll.scrollTop = 0;
  el.sheetWrap.hidden = false;
  document.body.classList.add('is-sheet-open');
}

function zamknijArkusz(){
  el.sheetWrap.hidden = true;
  el.sheetScroll.innerHTML = '';
  document.body.classList.remove('is-sheet-open');
}

/* ---------------- zielnik ---------------- */

async function odswiezLicznik(){
  const okazy = await wszystkieOkazy();
  el.herbCount.textContent = okazy.length;
  el.herbCount.hidden = okazy.length === 0;
  return okazy;
}

async function pokazZielnik(){
  const okazy = (await wszystkieOkazy()).reverse();
  el.herbEmpty.hidden = okazy.length > 0;
  el.herbGrid.innerHTML = okazy.map(o => `
    <button class="card" data-okaz="${o.id}">
      <span class="card__img"><img src="${o.mini || o.zdjecie}" alt=""></span>
      <span class="card__body">
        <span class="card__no">№ ${numerOkazu(o.id)}</span>
        <span class="card__pl">${esc(o.dane?.nazwa_pl || 'Nieoznaczony')}</span>
        <span class="card__lat">${esc(o.dane?.nazwa_lat || '')}</span>
      </span>
    </button>`).join('');
  otworzNakladke(el.herbarium);
}

/* ---------------- nakładki i komunikaty ---------------- */

function otworzNakladke(node){ node.hidden = false; }
function zamknijNakladki(){ el.herbarium.hidden = true; el.settings.hidden = true; }

let toastTimer;
function komunikat(tekst, blad = false){
  el.toast.textContent = tekst;
  el.toast.classList.toggle('toast--err', blad);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, blad ? 6000 : 3000);
}

/* ---------------- zdarzenia ---------------- */

$('#btn-start').addEventListener('click', async () => {
  const ok = await wlaczKamere();
  if(ok) pokazKamere();
});

$('#btn-intro-file').addEventListener('click', () => el.fileInput.click());
$('#btn-file').addEventListener('click', () => el.fileInput.click());

el.fileInput.addEventListener('change', async e => {
  const plik = e.target.files?.[0];
  e.target.value = '';
  if(!plik) return;
  try{
    const dataUrl = await zPliku(plik);
    pokazKamere();
    await analizuj(dataUrl);
  }catch(err){ komunikat(err.message, true); }
});

el.analyze.addEventListener('click', async () => {
  try{ await analizuj(zrobZdjecie()); }
  catch(e){ komunikat(e.message, true); }
});

el.flip.addEventListener('click', async () => {
  kamera = kamera === 'environment' ? 'user' : 'environment';
  await wlaczKamere();
});

$('#btn-herbarium').addEventListener('click', pokazZielnik);
$('#btn-settings').addEventListener('click', () => otworzNakladke(el.settings));

document.addEventListener('click', async e => {
  if(e.target.closest('[data-close-sheet]')) zamknijArkusz();
  if(e.target.closest('[data-close-overlay]')) zamknijNakladki();

  const karta = e.target.closest('[data-okaz]');
  if(karta){
    const okazy = await wszystkieOkazy();
    const okaz = okazy.find(o => o.id === Number(karta.dataset.okaz));
    if(okaz){ zamknijNakladki(); pokazArkusz(okaz); }
  }

  const usun = e.target.closest('[data-usun]');
  if(usun){
    await usunOkaz(Number(usun.dataset.usun));
    zamknijArkusz();
    await odswiezLicznik();
    komunikat('Okaz usunięty z zielnika.');
  }
});

document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  if(!el.sheetWrap.hidden) zamknijArkusz();
  else zamknijNakladki();
});

$$('input[name="provider"]').forEach(i => i.addEventListener('change', zapiszUstawienia));
el.apikey.addEventListener('input', zapiszUstawienia);
el.model.addEventListener('input', zapiszUstawienia);

$('#btn-clear').addEventListener('click', async () => {
  await wyczyscOkazy();
  await odswiezLicznik();
  el.herbGrid.innerHTML = '';
  el.herbEmpty.hidden = false;
  komunikat('Zielnik wyczyszczony.');
});

/* ---------------- start ---------------- */

wczytajUstawienia();
odswiezLicznik();

if('serviceWorker' in navigator && location.protocol !== 'file:'){
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
