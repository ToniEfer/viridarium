# Viridarium — rozpoznawanie roślin

PWA: kamera → przycisk „Analizuj" → arkusz zielnikowy z oznaczeniem gatunku,
opisem siedliska, zasadami uprawy i oceną kondycji. Każde rozpoznanie dopisuje
okaz do lokalnego zielnika.

## 1. Klucz API

Aplikacja nie ma własnego serwera — pyta wybrany silnik prosto z przeglądarki.

| Silnik | Skąd klucz | Domyślny model |
|---|---|---|
| **Gemini** | aistudio.google.com → *Get API key* | `gemini-2.5-flash` |
| **Claude** | console.anthropic.com → *API keys* | `claude-sonnet-4-5-20250929` |

Klucz wklejasz w aplikacji (ikona koła zębatego). Zapisuje się w `localStorage`
tej przeglądarki i nie wychodzi nigdzie poza wybrany silnik.

Jeśli silnik odpowie, że nie zna modelu — wpisz aktualny identyfikator w tym
samym oknie. Nazwy modeli się zmieniają.

## 2. Uruchomienie na komputerze

```bash
cd Viridarium
python3 -m http.server 8000
```

Otwórz `http://localhost:8000`. Aparat działa, bo `localhost` liczy się jako
bezpieczny kontekst.

Otwarcie pliku `index.html` przez podwójne kliknięcie **nie zadziała** —
protokół `file://` blokuje kamerę i service workera.

## 3. Uruchomienie na telefonie

Przeglądarka udostępnia kamerę tylko przez HTTPS. Adres typu `192.168.0.12:8000`
nie wystarczy. Trzy drogi, od najszybszej:

**a) Netlify Drop** — wejdź na app.netlify.com/drop i przeciągnij folder
`Viridarium`. Dostajesz adres HTTPS w kilkanaście sekund, bez konta.

**b) Tunel do komputera** — przy działającym `python3 -m http.server 8000`:

```bash
npx localtunnel --port 8000        # albo: cloudflared tunnel --url http://localhost:8000
```

**c) GitHub Pages** — repozytorium publiczne, Settings → Pages → *Deploy from a
branch*, gałąź `main`, katalog `/ (root)`. Adres wychodzi w postaci
`nazwa-uzytkownika.github.io/nazwa-repozytorium/`. Pole *Custom domain* zostaw
puste — służy do wpinania własnej domeny, którą się kupuje, nie do nazwania
aplikacji.

**d) Dowolny inny hosting statyczny** — Vercel, Netlify, własny serwer.

Zdjęcie z galerii (ikona obrazka obok spustu) działa zawsze, także bez HTTPS —
to droga awaryjna, gdy kamera jest niedostępna.

## 4. Instalacja na ekranie głównym

- **iPhone (Safari):** Udostępnij → *Dodaj do ekranu początkowego*
- **Android (Chrome):** menu ⋮ → *Zainstaluj aplikację*

Po instalacji uruchamia się pełnoekranowo, bez paska przeglądarki.

## 5. Zanim pokażesz to komuś poza sobą

Klucz w przeglądarce jest w porządku na własnym telefonie. Przy udostępnianiu
aplikacji innym każdy mógłby go podejrzeć i zużywać twój limit. Rozwiązanie:
mała funkcja pośrednicząca (Cloudflare Worker, Vercel Function), która trzyma
klucz po stronie serwera i przekazuje zdjęcie dalej. W `recognize.js` wystarczy
wtedy podmienić adres i usunąć nagłówki z kluczem.

## 6. Aktualizacja po zmianach

Service worker trzyma pliki w pamięci podręcznej, żeby aplikacja działała bez
sieci. Po każdej podmianie plików zmień w `sw.js` pierwszą linię:

```js
const CACHE = 'viridarium-v1';   // → 'viridarium-v2', 'v3', ...
```

Bez tego telefon może pokazywać starą wersję mimo wgrania nowej.

## 7. Pliki

```
index.html           struktura ekranów
app.css              cały wygląd, zmienne kolorów na górze
app.js               kamera, kadrowanie, baza okazów, składanie arkusza
recognize.js         komunikacja z silnikami + treść promptu
manifest.webmanifest metadane PWA
sw.js                cache powłoki aplikacji (offline)
icons/               ikony aplikacji
```

Treść promptu — czyli to, o co pytamy model i w jakiej strukturze ma odpowiedzieć
— siedzi w `recognize.js` w stałej `PROMPT`. Tam dodajesz nowe sekcje arkusza;
pamiętaj, żeby dodać im też miejsce w `arkuszHTML()` w `app.js`.

## 8. Granice

Oznaczenie z jednego zdjęcia bywa błędne, szczególnie przy gatunkach, które
rozróżnia się po kwiecie lub owocu. Pasek pewności pokazuje ocenę modelu, a przy
niskiej wartości arkusz wymienia gatunki podobne — traktuj to jako tropy, nie
werdykt.

Ocena kondycji opiera się wyłącznie na tym, co widać na zdjęciu.

Aplikacja celowo nie potwierdza jadalności ani zastosowań leczniczych. Pomyłka
w oznaczeniu rośliny jadalnej bywa groźna, a modele mylą gatunki podobne.

## 9. Kierunki rozwoju

- **Pl@ntNet API** jako drugi silnik — baza naukowa, mocna w dzikiej florze
  Europy; dobrze sprawdza się w układzie: Pl@ntNet oznacza gatunek, model
  językowy pisze opis.
- **Plant.id / Kindwise** — osobny moduł diagnozy chorób, jeśli kondycja ma być
  czymś więcej niż oceną z jednego zdjęcia.
- Zapis miejsca i daty zbioru przy okazie (geolokalizacja), eksport zielnika,
  filtrowanie po rodzinie.
