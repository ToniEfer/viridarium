/* ============================================================
   app.js — aparat, zielnik, arkusz wyniku
   ============================================================ */

const WERSJA = '1.8.2';   // musi zgadzać się z WERSJA w sw.js

/* Adres serwera pośredniczącego. Pusty = aplikacja wymaga własnego klucza API. */
const SERWER_URL = 'https://viridarium.toniefer.workers.dev';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const el = {
  intro: $('#intro'), introNote: $('#intro-note'),
  introHerb: $('#btn-intro-herb'), introHerbCount: $('#intro-herb-count'),
  camera: $('#camera'), video: $('#video'), hint: $('#hint'),
  analyze: $('#btn-analyze'), flip: $('#btn-flip'),
  fileInput: $('#file-input'),
  sheetWrap: $('#sheet-wrap'), sheetScroll: $('#sheet-scroll'),
  herbarium: $('#herbarium'), herbGrid: $('#herb-grid'), herbEmpty: $('#herb-empty'), herbCount: $('#herb-count'),
  settings: $('#settings'), apikey: $('#apikey'), model: $('#model'), providerHelp: $('#provider-help'),
  kluczDla: $('#klucz-dla'), awaryjny: $('#awaryjny'), testBtn: $('#btn-test'),
  trybSerwer: $('#tryb-serwer'), limitInfo: $('#limit-info'),
  zaaw: $('#zaawansowane'), zaawSum: $('#zaaw-sum'), zaawOpis: $('#zaaw-opis'),
  modelsBtn: $('#btn-models'), modelsOut: $('#models-out'),
  wersjaInfo: $('#wersja-info'), checkUpd: $('#btn-check-update'),
  introVer: $('#intro-ver'),
  updbar: $('#updbar'),
  busy: $('#busy'), busyImg: $('#busy-img'), busyStep: $('#busy-step'),
  toast: $('#toast')
};

const USTAWIENIA_KLUCZ = 'viridarium.ustawienia';

let ustawienia = {
  provider: 'gemini',
  klucze: { gemini: '', anthropic: '' },   // osobny klucz dla każdego silnika
  modele: { gemini: '', anthropic: '' },
  awaryjny: true
};

let strumien = null;
let kamera = 'environment';
let ostatniOkaz = null;
let ostatnieZdjecie = null;   // do ponowienia po nieudanej analizie

/* Losowy identyfikator tej instalacji — serwer liczy po nim dzienne analizy.
   Nie zawiera żadnych danych o użytkowniku. */
function idUrzadzenia(){
  const K = 'viridarium.urzadzenie';
  try{
    let id = localStorage.getItem(K);
    if(!id){
      id = crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now();
      localStorage.setItem(K, id);
    }
    return id;
  }catch{ return 'bez-pamieci-' + Date.now(); }
}

const wlasnyKlucz = () => ustawienia.klucze[ustawienia.provider];
const przezSerwerViridarium = () => SERWER_URL && !wlasnyKlucz();

/* ---------------- ustawienia ---------------- */

function wczytajUstawienia(){
  try{
    const zapisane = JSON.parse(localStorage.getItem(USTAWIENIA_KLUCZ) || '{}');
    ustawienia = {
      ...ustawienia, ...zapisane,
      klucze: { ...ustawienia.klucze, ...(zapisane.klucze || {}) },
      modele: { ...ustawienia.modele, ...(zapisane.modele || {}) }
    };
    // przeniesienie z układu sprzed 1.7.0, gdzie klucz był jeden na oba silniki
    if(zapisane.apiKey && !ustawienia.klucze[ustawienia.provider]){
      ustawienia.klucze[ustawienia.provider] = zapisane.apiKey;
      ustawienia.modele[ustawienia.provider] = zapisane.model || '';
      delete ustawienia.apiKey; delete ustawienia.model;
      zapisz();
    }
  }catch{ /* pierwsze uruchomienie */ }

  $$('input[name="provider"]').forEach(i => { i.checked = i.value === ustawienia.provider; });
  el.awaryjny.checked = ustawienia.awaryjny !== false;
  pokazPolaSilnika();
  ukladUstawien();
}

function ukladUstawien(){
  if(SERWER_URL){
    el.trybSerwer.hidden = false;
    el.zaaw.classList.remove('zaaw--wymagane');
    el.zaawSum.textContent = 'Własny klucz API · opcjonalnie';
    el.zaawOpis.hidden = false;
  }else{
    // bez serwera klucz jest jedyną drogą — pole musi być na wierzchu
    el.trybSerwer.hidden = true;
    el.zaaw.open = true;
    el.zaaw.classList.add('zaaw--wymagane');
    el.zaawSum.textContent = 'Klucz API';
    el.zaawOpis.hidden = true;
  }
}

/* Pola klucza i modelu zawsze pokazują dane silnika, który jest włączony. */
function pokazPolaSilnika(){
  const p = ustawienia.provider;
  el.apikey.value = ustawienia.klucze[p] || '';
  el.model.value = ustawienia.modele[p] || '';
  el.model.placeholder = PROVIDERS[p].model;
  el.providerHelp.textContent = PROVIDERS[p].skad;
  el.kluczDla.textContent = `· ${PROVIDERS[p].nazwa}`;
  el.modelsOut.hidden = true;
}

function zapisz(){
  try{ localStorage.setItem(USTAWIENIA_KLUCZ, JSON.stringify(ustawienia)); }catch{ /* tryb prywatny */ }
}

function zapiszUstawienia(){
  const p = ustawienia.provider;
  ustawienia.klucze[p] = el.apikey.value.trim();
  ustawienia.modele[p] = el.model.value.trim();
  ustawienia.awaryjny = el.awaryjny.checked;
  zapisz();
}

function zmienSilnik(){
  ustawienia.provider = $('input[name="provider"]:checked')?.value || 'gemini';
  zapisz();
  pokazPolaSilnika();
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

async function wlaczKamere({ nowaKamera = kamera, cicho = false } = {}){
  if(!navigator.mediaDevices?.getUserMedia){
    zglos('Ta przeglądarka nie udostępnia aparatu. Użyj zdjęcia z galerii.', cicho);
    return false;
  }
  if(!window.isSecureContext){
    zglos('Aparat działa tylko przez HTTPS lub na localhost. Zdjęcie z galerii działa zawsze.', cicho);
    return false;
  }
  try{
    // Nowy strumień bierzemy PRZED zgaszeniem starego — gdyby się nie udało,
    // zostajemy przy obrazie, który już mamy, zamiast z czarnym ekranem.
    const swiezy = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: nowaKamera }, width: { ideal: 1920 }, height: { ideal: 1920 } },
      audio: false
    });
    if(strumien && strumien !== swiezy) strumien.getTracks().forEach(t => t.stop());
    strumien = swiezy;
    kamera = nowaKamera;
    el.video.srcObject = strumien;
    pilnujStrumienia();
    await el.video.play().catch(() => {});
    return true;
  }catch(e){
    const tekst = e.name === 'NotAllowedError'
      ? 'Brak zgody na dostęp do aparatu. Stuknij ikonę po lewej stronie adresu → Uprawnienia → Kamera.'
      : e.name === 'NotReadableError'
        ? 'Aparat jest zajęty przez inną aplikację. Zamknij ją i spróbuj ponownie.'
        : 'Nie udało się uruchomić aparatu. Użyj zdjęcia z galerii.';
    zglos(tekst, cicho);
    return false;
  }
}

/* Komunikat trafia tam, gdzie użytkownik akurat patrzy. */
function zglos(tekst, cicho){
  if(cicho) return;
  if(el.camera.hidden) el.introNote.textContent = tekst;
  else komunikat(tekst, true);
}

function kameraZywa(){
  return !!strumien?.getVideoTracks().some(t => t.readyState === 'live');
}

/* Android usypia kamerę, gdy schodzisz do innej aplikacji. Wracamy — wznawiamy. */
function pilnujStrumienia(){
  strumien.getVideoTracks().forEach(t => {
    t.onended = () => { if(!el.camera.hidden) wznow(); };
  });
}

let wznawianie = false;
async function wznow(){
  if(wznawianie || kameraZywa()) return;
  wznawianie = true;
  el.hint.textContent = 'Wznawiam podgląd…';
  const ok = await wlaczKamere({ cicho: true });
  el.hint.textContent = ok ? HINT : 'Stuknij kadr, żeby wznowić podgląd';
  wznawianie = false;
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

const HINT = 'Wypełnij kadr liściem lub kwiatem';

const KROKI = ['Przygotowuję okaz', 'Porównuję cechy', 'Oznaczam gatunek', 'Spisuję arkusz'];

async function analizuj(dataUrl){
  if(!przezSerwerViridarium() && !wlasnyKlucz()){
    otworzNakladke(el.settings);
    komunikat(`Najpierw wklej klucz dla silnika ${PROVIDERS[ustawienia.provider].nazwa}.`, true);
    return;
  }
  ostatnieZdjecie = dataUrl;

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

  // gdy silnik każe czekać, licznik kroków ustępuje miejsca prawdziwemu stanowi
  const naStatus = tekst => { clearInterval(tyka); el.busyStep.textContent = tekst; };

  try{
    const dane = przezSerwerViridarium()
      ? await przezSerwer({ serwer: SERWER_URL, dataUrl, urzadzenie: idUrzadzenia() })
      : await recognize({
          dataUrl,
          provider: ustawienia.provider,
          klucze: ustawienia.klucze,
          modele: ustawienia.modele,
          awaryjny: ustawienia.awaryjny !== false,
          naStatus
        });

    const okaz = {
      dane,
      zdjecie: dataUrl,
      mini: await miniatura(dataUrl),
      data: new Date().toISOString()
    };
    okaz.id = await dodajOkaz(okaz);
    if(typeof dane._pozostalo === 'number') pokazLimit(dane._pozostalo);

    const silnik = dane._silnik || ustawienia.provider;
    if(!przezSerwerViridarium() && dane._model && dane._model !== ustawienia.modele[silnik]){
      ustawienia.modele[silnik] = dane._model;
      zapisz();
      if(silnik === ustawienia.provider) el.model.value = dane._model;
      komunikat(`Przełączono na model ${dane._model}.`);
    }
    ostatniOkaz = okaz;
    await odswiezLicznik();
    pokazArkusz(okaz);
  }catch(e){
    if(typeof e.pozostalo === 'number') pokazLimit(e.pozostalo);
    // limit i brak rośliny to nie awarie — ponawianie nic tu nie da
    const bezPonowienia = ['limit', 'pula', 'brak-rosliny', 'limit-dostawcy', 'klucz'].includes(e.kod);
    // zdjęcie zostaje w pamięci, więc ponowienie nie wymaga ustawiania kadru od nowa
    komunikat(e.message, true, bezPonowienia ? null : { etykieta: 'Ponów', akcja: () => analizuj(ostatnieZdjecie) });
  }finally{
    clearInterval(tyka);
    el.busy.hidden = true;
    el.camera.classList.remove('is-scanning');
    el.analyze.disabled = false;
  }
}

function pokazLimit(pozostalo){
  el.limitInfo.textContent = `Dziś zostało: ${pozostalo}.`;
  if(pozostalo > 0 && pozostalo <= 3)
    setTimeout(() => komunikat(`Zostały dziś ${pozostalo} analizy. Limit odnowi się jutro.`), 3200);
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

function odmianaOkazow(n){
  const jed = n % 10, dwie = n % 100;
  if(n === 1) return 'okaz';
  if(jed >= 2 && jed <= 4 && !(dwie >= 12 && dwie <= 14)) return 'okazy';
  return 'okazów';
}

async function odswiezLicznik(){
  const okazy = await wszystkieOkazy();
  el.herbCount.textContent = okazy.length;
  el.herbCount.hidden = okazy.length === 0;

  // wejście do zielnika jest zawsze widoczne — pusty zielnik sam powie, że jest pusty
  el.introHerb.hidden = false;
  el.introHerbCount.textContent = okazy.length
    ? `· ${okazy.length} ${odmianaOkazow(okazy.length)}`
    : '';
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
function komunikat(tekst, blad = false, akcja = null){
  el.toast.textContent = tekst;
  el.toast.classList.toggle('toast--err', blad);

  if(akcja){
    const b = document.createElement('button');
    b.className = 'toast__akcja';
    b.textContent = akcja.etykieta;
    b.addEventListener('click', () => { el.toast.hidden = true; akcja.akcja(); });
    el.toast.appendChild(b);
  }

  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, akcja ? 12000 : blad ? 6000 : 3000);
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

el.flip.addEventListener('click', () =>
  wlaczKamere({ nowaKamera: kamera === 'environment' ? 'user' : 'environment' }));

document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible' && !el.camera.hidden) wznow();
});

el.video.addEventListener('click', wznow);

$('#btn-herbarium').addEventListener('click', pokazZielnik);
el.introHerb.addEventListener('click', pokazZielnik);   // zielnik bez uruchamiania aparatu
$('#btn-settings').addEventListener('click', () => otworzNakladke(el.settings));

document.addEventListener('click', async e => {
  if(e.target.closest('[data-close-sheet]')) zamknijArkusz();
  if(e.target.closest('[data-close-overlay]')) zamknijNakladki();

  const karta = e.target.closest('[data-okaz]');
  if(karta){
    const okazy = await wszystkieOkazy();
    const okaz = okazy.find(o => o.id === Number(karta.dataset.okaz));
    if(okaz){ zamknijNakladki(); pokazArkusz(okaz); }   // pod spodem zostaje ten ekran, z którego przyszliśmy
  }

  const wybor = e.target.closest('[data-model]');
  if(wybor){
    el.model.value = wybor.dataset.model;
    zapiszUstawienia();
    $$('[data-model]').forEach(b => b.setAttribute('aria-current', String(b === wybor)));
    komunikat(`Wybrano model ${wybor.dataset.model}.`);
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

$$('input[name="provider"]').forEach(i => i.addEventListener('change', zmienSilnik));
el.awaryjny.addEventListener('change', zapiszUstawienia);
el.apikey.addEventListener('input', zapiszUstawienia);
el.model.addEventListener('input', zapiszUstawienia);

el.modelsBtn.addEventListener('click', async () => {
  if(!ustawienia.klucze.gemini){ komunikat('Najpierw wklej klucz Gemini.', true); return; }
  if(ustawienia.provider !== 'gemini'){ komunikat('Lista modeli działa na razie tylko dla Gemini.', true); return; }

  el.modelsBtn.disabled = true;
  el.modelsBtn.textContent = 'Sprawdzam…';
  try{
    const nazwy = await listujModeleGemini(ustawienia.klucze.gemini);
    if(!nazwy.length){
      el.modelsOut.hidden = true;
      komunikat('Klucz działa, ale nie udostępnia żadnego modelu do analizy zdjęć.', true);
      return;
    }
    const polecany = wybierzModelGemini(nazwy);
    const aktualny = ustawienia.modele.gemini || PROVIDERS.gemini.model;
    el.modelsOut.innerHTML = `
      <p class="models__head">Dostępne dla twojego klucza (${nazwy.length}) — stuknij, żeby wybrać</p>
      <ul class="models__list">${nazwy.map(n => `
        <li><button type="button" data-model="${esc(n)}" aria-current="${n === aktualny}">
          <span>${esc(n)}</span>${n === polecany ? '<em>polecany</em>' : ''}
        </button></li>`).join('')}</ul>`;
    el.modelsOut.hidden = false;
    komunikat(`Znaleziono ${nazwy.length} modeli. Polecany: ${polecany}.`);
  }catch(e){
    el.modelsOut.hidden = true;
    komunikat(e.message, true);
  }finally{
    el.modelsBtn.disabled = false;
    el.modelsBtn.textContent = 'Sprawdź modele';
  }
});

el.testBtn.addEventListener('click', async () => {
  const p = ustawienia.provider;
  if(!ustawienia.klucze[p]){ komunikat(`Brak klucza dla silnika ${PROVIDERS[p].nazwa}.`, true); return; }

  el.testBtn.disabled = true;
  el.testBtn.textContent = 'Sprawdzam…';
  try{
    const wynik = await testPolaczenia({ provider: p, apiKey: ustawienia.klucze[p], model: ustawienia.modele[p] });
    komunikat(`${PROVIDERS[p].nazwa} odpowiada. Model ${wynik.model} działa.`);
  }catch(e){
    komunikat(e.message, true);
  }finally{
    el.testBtn.disabled = false;
    el.testBtn.textContent = 'Sprawdź połączenie';
  }
});

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
pokazWersje();

/* ---------------- wersja ---------------- */

/* Pyta service workera, jaką wersję plików faktycznie serwuje.
   Rozjazd z WERSJA oznacza, że aplikacja chodzi na starym rdzeniu. */
function wersjaRdzenia(){
  return new Promise(gotowe => {
    const sw = navigator.serviceWorker?.controller;
    if(!sw) return gotowe(null);
    const kanal = e => {
      if(e.data?.typ === 'WERSJA'){
        navigator.serviceWorker.removeEventListener('message', kanal);
        gotowe(e.data.wersja);
      }
    };
    navigator.serviceWorker.addEventListener('message', kanal);
    sw.postMessage({ typ: 'JAKA_WERSJA' });
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', kanal);
      gotowe(null);
    }, 1500);
  });
}

async function pokazWersje(){
  const zainstalowana = window.matchMedia('(display-mode: standalone)').matches;
  el.introVer.textContent = `wersja ${WERSJA}`;
  el.wersjaInfo.textContent = `Viridarium ${WERSJA}${zainstalowana ? ' · zainstalowana' : ' · w przeglądarce'}`;

  const rdzen = await wersjaRdzenia();
  if(!rdzen){
    el.wersjaInfo.textContent += ' · bez trybu offline';
    return;
  }
  if(rdzen !== WERSJA){
    el.introVer.textContent = `wersja ${WERSJA} · rdzeń ${rdzen} — odśwież`;
    el.introVer.classList.add('is-rozjazd');
    el.wersjaInfo.textContent += ` · rdzeń ${rdzen}, niezgodny`;
  }
}

/* ---------------- aktualizacje ---------------- */

let rejestracja = null;
let czekajacy = null;      // nowy service worker gotowy do wejścia
let juzPrzeladowano = false;
let ostatnieSprawdzenie = 0;

function pokazPasekAktualizacji(sw){
  czekajacy = sw;
  el.updbar.hidden = false;
}

/* Nowa wersja wchodzi dopiero, gdy użytkownik ją przyjmie — nigdy w trakcie analizy. */
$('#btn-update').addEventListener('click', () => {
  if(!czekajacy) { location.reload(); return; }
  el.updbar.hidden = true;
  komunikat('Wgrywam nową wersję…');
  czekajacy.postMessage({ typ: 'WPUSC_NOWA' });
});

$('#btn-update-later').addEventListener('click', () => { el.updbar.hidden = true; });

async function sprawdzAktualizacje({ recznie = false } = {}){
  if(!rejestracja) {
    if(recznie) komunikat('Aktualizacje działają dopiero po zainstalowaniu aplikacji.', true);
    return;
  }
  const teraz = Date.now();
  if(!recznie && teraz - ostatnieSprawdzenie < 15 * 60 * 1000) return;   // nie częściej niż co kwadrans
  ostatnieSprawdzenie = teraz;

  try{
    await rejestracja.update();

    // update() wraca, zanim nowy worker skończy się instalować — trzeba na niego poczekać,
    // inaczej aplikacja ogłasza „masz najnowszą wersję" tuż przed pokazaniem paska.
    const nowy = rejestracja.waiting || rejestracja.installing;
    if(nowy){
      const stan = await poZainstalowaniu(nowy);
      if(stan === 'installed' || stan === 'activated'){
        pokazPasekAktualizacji(rejestracja.waiting || nowy);
        if(recznie) komunikat('Nowa wersja gotowa — stuknij Odśwież.');
        return;
      }
    }
    if(recznie) komunikat(`Masz najnowszą wersję (${WERSJA}).`);
  }catch{
    if(recznie) komunikat('Nie udało się sprawdzić aktualizacji. Sprawdź połączenie.', true);
  }
}

function poZainstalowaniu(sw){
  return new Promise(gotowe => {
    if(sw.state !== 'installing') return gotowe(sw.state);
    sw.addEventListener('statechange', () => {
      if(sw.state !== 'installing') gotowe(sw.state);
    });
  });
}

el.checkUpd.addEventListener('click', async () => {
  await sprawdzAktualizacje({ recznie: true });
  pokazWersje();
});

if('serviceWorker' in navigator && location.protocol !== 'file:'){
  window.addEventListener('load', async () => {
    try{
      rejestracja = await navigator.serviceWorker.register('sw.js');

      // wersja już czekała z poprzedniego uruchomienia
      if(rejestracja.waiting && navigator.serviceWorker.controller)
        pokazPasekAktualizacji(rejestracja.waiting);

      // wersja pojawia się w trakcie działania aplikacji
      rejestracja.addEventListener('updatefound', () => {
        const swiezy = rejestracja.installing;
        if(!swiezy) return;
        swiezy.addEventListener('statechange', () => {
          if(swiezy.state === 'installed' && navigator.serviceWorker.controller)
            pokazPasekAktualizacji(swiezy);
        });
      });

      sprawdzAktualizacje();
    }catch{ /* brak service workera nie psuje aplikacji */ }
  });

  // po przejęciu przez nową wersję strona wczytuje się raz, sama
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if(juzPrzeladowano) return;
    juzPrzeladowano = true;
    location.reload();
  });
}

// powrót do aplikacji to najlepszy moment na sprawdzenie, czy coś się zmieniło
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible') sprawdzAktualizacje();
});
