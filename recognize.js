/* ============================================================
   recognize.js — warstwa rozpoznawania
   Jedna funkcja wejściowa: recognize({dataUrl, provider, apiKey, model})
   Zwraca obiekt okazu albo rzuca błąd z komunikatem po polsku.
   ============================================================ */

const PROVIDERS = {
  gemini: {
    nazwa: 'Gemini',
    model: 'gemini-3.8-flash',
    skad: 'Klucz z Google AI Studio (aistudio.google.com) — darmowy limit wystarcza na testy.'
  },
  anthropic: {
    nazwa: 'Claude',
    model: 'claude-sonnet-4-5-20250929',
    skad: 'Klucz z console.anthropic.com. Wywołanie idzie prosto z przeglądarki.'
  }
};

const PROMPT = `Jesteś botanikiem oznaczającym okaz ze zdjęcia. Odpowiadasz wyłącznie po polsku.

Obejrzyj zdjęcie i oznacz roślinę najdokładniej, jak pozwala materiał. Jeśli zdjęcie nie przedstawia rośliny albo jest zbyt niewyraźne, żeby cokolwiek oznaczyć, ustaw "rozpoznano" na false i w "powod" napisz jednym zdaniem, co utrudnia oznaczenie.

Zasady:
- "pewnosc" to liczba 0-100, twoja realna ocena trafności oznaczenia. Nie zawyżaj. Przy gatunkach, których nie da się rozróżnić bez kwiatu lub owocu, podaj niską wartość i wymień alternatywy.
- "kondycja" oceniaj tylko na podstawie tego, co widać na zdjęciu: przebarwienia, plamy, więdnięcie, szkodniki, uszkodzenia. Jeśli roślina wygląda zdrowo, napisz to wprost. Nie zgaduj chorób, których nie widać.
- W "bezpieczenstwo.toksycznosc" napisz krótko, czy roślina jest trująca dla ludzi lub zwierząt domowych. NIGDY nie potwierdzaj, że roślina jest jadalna, i nie podawaj zastosowań leczniczych ani przepisów.
- Pisz konkretnie i rzeczowo, bez ozdobników. Zdania pełne, nie równoważniki.

Zwróć WYŁĄCZNIE obiekt JSON w tej strukturze, bez komentarzy i bez bloku kodu:
{
  "rozpoznano": true,
  "powod": "",
  "nazwa_pl": "polska nazwa zwyczajowa",
  "nazwa_lat": "Nazwa gatunkowa",
  "rodzina": "polska nazwa rodziny",
  "pewnosc": 0,
  "alternatywy": [{"nazwa_pl": "", "nazwa_lat": "", "pewnosc": 0}],
  "opis": "2-3 zdania: pokrój, liście, kwiaty, cechy rozpoznawcze",
  "wystepowanie": "2-3 zdania: zasięg naturalny, siedlisko, czy występuje w Polsce",
  "uprawa": {
    "stanowisko": "",
    "podlewanie": "",
    "gleba": "",
    "temperatura": "",
    "rozmnazanie": "",
    "trudnosc": "łatwa | umiarkowana | wymagająca"
  },
  "kondycja": {
    "ocena": "dobra | sygnaly | zla",
    "obserwacje": ["co widać na zdjęciu"],
    "zalecenia": ["co zrobić"]
  },
  "bezpieczenstwo": { "toksycznosc": "", "ostrzezenie": "" },
  "ciekawostka": "jedno zdanie"
}`;

/* ---------- pomocnicze ---------- */

function rozbijDataUrl(dataUrl){
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if(!m) throw new Error('Nie udało się odczytać zdjęcia.');
  return { mime: m[1], base64: m[2] };
}

function wyciagnijJSON(tekst){
  if(!tekst) throw new Error('Silnik zwrócił pustą odpowiedź.');
  let t = tekst.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if(start === -1 || end === -1) throw new Error('Silnik nie zwrócił danych w oczekiwanym formacie.');
  return JSON.parse(t.slice(start, end + 1));
}

function spij(ms){ return new Promise(r => setTimeout(r, ms)); }

async function bladHTTP(res, domyslny){
  let szczegol = '';
  try{
    const data = await res.json();
    szczegol = data?.error?.message || data?.error?.type || '';
  }catch{ /* odpowiedź bez JSON-a */ }

  if(res.status === 401 || res.status === 403)
    throw new Error('Klucz API został odrzucony. Sprawdź go w ustawieniach.');
  if(res.status === 404)
    throw new Error(szczegol
      ? `Silnik nie zna tego modelu: ${szczegol}`
      : 'Silnik nie zna tego modelu. Użyj przycisku „Sprawdź modele" w ustawieniach.');
  if(res.status === 429){
    const e = new Error('Limit zapytań wyczerpany. Silnik prosi o przerwę.');
    e.przeciazony = true;
    throw e;
  }
  if(res.status === 503 || res.status === 500 || /high demand|overload|unavailable/i.test(szczegol)){
    const e = new Error('Silnik jest w tej chwili przeciążony.');
    e.przeciazony = true;
    throw e;
  }
  throw new Error(szczegol ? `${domyslny} ${szczegol}` : domyslny);
}

/* ---------- lista modeli Gemini ---------- */

const ODPADA = /image|imagen|tts|audio|embedding|embed|aqa|veo|live/i;

/* Pobiera modele, które ten klucz może wywołać przez generateContent. */
async function listujModeleGemini(apiKey){
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': apiKey }
  });
  if(!res.ok) await bladHTTP(res, 'Nie udało się pobrać listy modeli.');
  const data = await res.json();
  return (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => String(m.name).replace(/^models\//, ''))
    .filter(n => !ODPADA.test(n));
}

/* Najnowszy „flash" wygrywa: tani, szybki, widzi obrazy. */
function wybierzModelGemini(nazwy){
  const wersja = n => {
    const m = /gemini-(\d+(?:\.\d+)?)/.exec(n);
    return m ? parseFloat(m[1]) : 0;
  };
  const punkty = n =>
    (/flash/.test(n) ? 100 : /pro/.test(n) ? 50 : 0) +
    (/lite/.test(n) ? -10 : 0) +
    (/preview|exp/.test(n) ? -25 : 0);

  return [...nazwy].sort((a, b) =>
    (punkty(b) - punkty(a)) || (wersja(b) - wersja(a)) || a.length - b.length
  )[0];
}

/* ---------- Gemini ---------- */

async function przezGemini({ base64, mime, apiKey, model }){
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [ { text: PROMPT }, { inline_data: { mime_type: mime, data: base64 } } ] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 2400 }
    })
  });
  if(!res.ok) await bladHTTP(res, 'Gemini odrzucił zapytanie.');
  const data = await res.json();
  const tekst = data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
  return wyciagnijJSON(tekst);
}

/* ---------- Claude ---------- */

async function przezAnthropic({ base64, mime, apiKey, model }){
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: 2400,
      temperature: 0.2,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
          { type: 'text', text: PROMPT }
        ]
      }]
    })
  });
  if(!res.ok) await bladHTTP(res, 'Claude odrzucił zapytanie.');
  const data = await res.json();
  const tekst = data?.content?.map(b => b.text).filter(Boolean).join('') || '';
  return wyciagnijJSON(tekst);
}

/* ---------- wejście ---------- */

const PRZERWY = [1500, 4000, 9000];   // silnik pod obciążeniem zwykle wraca w kilka sekund

/* Droga domyślna: przez serwer Viridarium. Klucz API zostaje na serwerze,
   serwer sam ponawia, podmienia modele i przełącza silniki. */
async function przezSerwer({ serwer, dataUrl, urzadzenie }){
  let res;
  try{
    res = await fetch(`${serwer}/analiza`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ obraz: dataUrl, urzadzenie })
    });
  }catch{
    throw new Error('Brak połączenia z serwerem. Sprawdź internet.');
  }

  let d = {};
  try{ d = await res.json(); }catch{ /* pusta odpowiedź */ }

  if(!res.ok){
    const e = new Error(d.blad || `Serwer odpowiedział kodem ${res.status}.`);
    e.kod = d.kod;
    e.pozostalo = d.pozostalo;
    throw e;
  }
  const wynik = d.wynik;
  wynik._pozostalo = d.pozostalo;
  return wynik;
}

/* Jedno podejście do jednego silnika: ponawianie przy przeciążeniu,
   a dla Gemini także podmiana modelu, gdy nazwa przestała istnieć. */
async function przezSilnik({ silnik, base64, mime, apiKey, model, naStatus }){
  const uzytyModel = model || PROVIDERS[silnik].model;
  const zapytaj = m => silnik === 'anthropic'
    ? przezAnthropic({ base64, mime, apiKey, model: m })
    : przezGemini({ base64, mime, apiKey, model: m });

  let ostatni;
  for(let i = 0; i <= PRZERWY.length; i++){
    try{ return await zapytaj(uzytyModel); }
    catch(e){
      ostatni = e;
      if(!e.przeciazony || i === PRZERWY.length) break;
      naStatus(`${PROVIDERS[silnik].nazwa} zajęty — ponawiam (${i + 1}/${PRZERWY.length})`);
      await spij(PRZERWY[i]);
    }
  }

  if(silnik === 'gemini' && (ostatni?.przeciazony || /nie zna tego modelu/i.test(ostatni?.message || ''))){
    const dostepne = await listujModeleGemini(apiKey).catch(() => []);
    for(const kandydat of dostepne.filter(n => n !== uzytyModel).slice(0, 3)){
      naStatus(`Przechodzę na ${kandydat}`);
      try{
        const wynik = await zapytaj(kandydat);
        wynik._model = kandydat;
        return wynik;
      }catch(e){ ostatni = e; }
    }
  }
  throw ostatni || new Error('Nie udało się wykonać analizy.');
}

/* Sprawdza sam klucz, bez robienia zdjęcia. Kosztuje ułamek grosza. */
async function testPolaczenia({ provider, apiKey, model }){
  if(!apiKey) throw new Error('Brak klucza dla tego silnika.');
  const uzytyModel = model || PROVIDERS[provider].model;

  if(provider === 'gemini'){
    const nazwy = await listujModeleGemini(apiKey);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(uzytyModel)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'ok' }] }], generationConfig: { maxOutputTokens: 1 } })
    });
    if(!res.ok) await bladHTTP(res, 'Silnik odrzucił zapytanie próbne.');
    return { modeli: nazwy.length, model: uzytyModel };
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({ model: uzytyModel, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] })
  });
  if(!res.ok) await bladHTTP(res, 'Silnik odrzucił zapytanie próbne.');
  return { model: uzytyModel };
}

/* Wejście: próbuje wybranego silnika, a gdy ten zawiedzie — drugiego,
   o ile ma wpisany własny klucz. */
async function recognize({ dataUrl, provider, klucze = {}, modele = {}, awaryjny = true, naStatus = () => {} }){
  if(!klucze[provider])
    throw new Error(`Brakuje klucza dla silnika ${PROVIDERS[provider].nazwa}. Otwórz ustawienia i wklej go.`);

  const { base64, mime } = rozbijDataUrl(dataUrl);
  const drugi = provider === 'gemini' ? 'anthropic' : 'gemini';
  const kolejka = [provider];
  if(awaryjny && klucze[drugi]) kolejka.push(drugi);

  let ostatni;
  for(const silnik of kolejka){
    if(silnik !== provider) naStatus(`Przechodzę na ${PROVIDERS[silnik].nazwa}`);
    try{
      const wynik = await przezSilnik({
        silnik, base64, mime,
        apiKey: klucze[silnik], model: modele[silnik], naStatus
      });
      wynik._silnik = silnik;
      if(wynik.rozpoznano === false)
        throw new Error(wynik.powod || 'Na tym zdjęciu nie widać rośliny, którą da się oznaczyć.');
      return wynik;
    }catch(e){
      if(e instanceof TypeError) ostatni = new Error('Brak połączenia z siecią.');
      else ostatni = e;
      // brak rośliny na zdjęciu to odpowiedź, nie awaria — drugi silnik nic tu nie poprawi
      if(/nie widać rośliny|nie przedstawia/i.test(ostatni.message)) throw ostatni;
    }
  }

  if(ostatni?.przeciazony && kolejka.length === 1)
    throw new Error('Silnik jest oblegany i odrzuca zapytania. Wpisz w ustawieniach drugi klucz, a aplikacja sama się przełączy.');
  throw ostatni || new Error('Nie udało się wykonać analizy.');
}
