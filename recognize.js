/* ============================================================
   recognize.js — warstwa rozpoznawania
   Jedna funkcja wejściowa: recognize({dataUrl, provider, apiKey, model})
   Zwraca obiekt okazu albo rzuca błąd z komunikatem po polsku.
   ============================================================ */

const PROVIDERS = {
  gemini: {
    nazwa: 'Gemini',
    model: 'gemini-2.5-flash',
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

async function bladHTTP(res, domyslny){
  let szczegol = '';
  try{
    const data = await res.json();
    szczegol = data?.error?.message || data?.error?.type || '';
  }catch{ /* odpowiedź bez JSON-a */ }

  if(res.status === 401 || res.status === 403)
    throw new Error('Klucz API został odrzucony. Sprawdź go w ustawieniach.');
  if(res.status === 404)
    throw new Error('Silnik nie zna tego modelu. Wpisz aktualny identyfikator w ustawieniach.');
  if(res.status === 429)
    throw new Error('Przekroczony limit zapytań. Spróbuj za chwilę.');
  throw new Error(szczegol ? `${domyslny} ${szczegol}` : domyslny);
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

async function recognize({ dataUrl, provider, apiKey, model }){
  if(!apiKey) throw new Error('Brakuje klucza API. Otwórz ustawienia i wklej klucz.');
  const { base64, mime } = rozbijDataUrl(dataUrl);
  const uzytyModel = model || PROVIDERS[provider].model;

  let wynik;
  try{
    wynik = provider === 'anthropic'
      ? await przezAnthropic({ base64, mime, apiKey, model: uzytyModel })
      : await przezGemini({ base64, mime, apiKey, model: uzytyModel });
  }catch(e){
    if(e instanceof TypeError)
      throw new Error('Brak połączenia z silnikiem. Sprawdź internet.');
    throw e;
  }

  if(wynik.rozpoznano === false)
    throw new Error(wynik.powod || 'Na tym zdjęciu nie widać rośliny, którą da się oznaczyć.');

  return wynik;
}
