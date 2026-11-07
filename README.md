# Totalna Kompromitacja

Nerdowski teleturniej w stylu Jeopardy na Discorda. Statyczna strona (GitHub Pages), bez serwera.

## Jak grać

1. Prowadzący otwiera `host.html` (panel, tego nie streamuje).
2. W panelu klika **Ekran streamu**, w nowym oknie klika raz (dźwięk), `F` = pełny ekran. To okno udostępnia na Discordzie.
   Po kliknięciu Chrome/Edge zapyta o udostępnienie tej karty: **zezwól** (pasek „Udostępniasz tę kartę” można schować przyciskiem „Ukryj”). Bez tego przeglądarka przestaje rysować planszę, gdy jej okno jest zakryte panelem, i Discord pokazuje zamrożony obraz. Obraz z tego udostępnienia nigdzie nie wychodzi. Jeśli ktoś je zatrzyma, plansza pokaże komunikat, a kliknięcie w nią włącza je znowu. Zminimalizowane okno i tak stoi, więc planszy nie minimalizuj.
3. Gracze wchodzą z telefonu w link albo skanują QR ze streamu (`play.html?r=KOD`) i wpisują nick.
4. **Wczytaj folder**: folder z pytaniami (plik JSON + podfolder `media/`). Jeśli w folderze jest kilka JSON-ów, panel zapyta, który gramy. **Wczytaj pliki** przyjmuje sam JSON albo JSON razem z plikami mediów. Pytania i media zostają tylko w przeglądarce prowadzącego (localStorage + IndexedDB), nie trafiają do repo.
5. Start odcinka: **Czołówka** (animacja z muzyką na streamie, ok. 11 s), potem **Zasady** (prowadzący czyta tekst z panelu, stream pokazuje skrót), potem pierwsza runda.

## Po odcinku: Hall of Shame, kara, ranking sezonu

- **Hall of Shame**: w trakcie pytania, odpowiedzi albo odsłaniania finału klawisz `H` (albo kliknięcie w pole „Hall of Shame”) otwiera wpis. Gracz jest podpowiedziany (ten, kto właśnie odpowiadał), wpisujesz, co powiedział, `Enter` zapisuje. Po odcinku wybierasz, która odpowiedź idzie na slajd, reszta pokazuje się jako nominacje.
- **Kara**: zwycięzca wybiera ostatniemu miejscu nick i avatar na Discordzie na 7 dni. Panel podpowiada pierwsze i ostatnie miejsce (przy remisie klikasz ręcznie), a nowy nick wpisujesz, gdy zwycięzca go wymyśli. Domyślne zasady mają o tym osobny slajd.
- **Ranking sezonu**: „Zapisz odcinek do sezonu” na ekranie końcowym dopisuje wyniki (ten sam numer odcinka nadpisuje stary zapis). Suma punktów ze wszystkich odcinków, top 3 gra w finale sezonu. Sezon leży w przeglądarce prowadzącego (nie znika przy „Nowa gra”), a **Eksport JSON** / **Import JSON** przenosi go na inny komputer. Gracze łączą się po nicku. Ranking można pokazać na streamie także z poczekalni.

Na ekranie końcowym przełączasz, co widzi stream: wyniki odcinka, Hall of Shame, kara, ranking sezonu.

## Skróty w panelu

`Spacja` otwórz buzzery · `D` dobrze · `Z` źle · `P` połowa · `N` nikt nie wie · `Enter` dalej · `1–6` zgłoszenie ręczne (gdy komuś nie działa telefon) · `Ctrl+Z` cofnij · `M` muzyka graj/pauza · `R` muzyka od początku · `H` Hall of Shame · `←`/`→` poprzednia/następna zasada.

## Plik z pytaniami

Wzór: `pytania/przyklad.json`. Każda runda ma `values` (stawki) i `categories`; każda kategoria ma tyle pytań, ile stawek.
Pytanie: `q` (treść), `a` (odpowiedź), opcjonalnie `alt` (inne akceptowane odpowiedzi), `note` (ciekawostka dla prowadzącego) i media:

- `image`: obrazek pokazywany razem z pytaniem,
- `answerImage`: obrazek pokazywany dopiero z odpowiedzią,
- `audio`: klip, który prowadzący puszcza z panelu (gra okno streamu), `audioStart` i `audioEnd` w sekundach wycinają fragment.

Ścieżki mediów są względne do pliku JSON (`media/kadr.jpg`) albo to pełne adresy `https://`. Obrazki jpg/png/webp/svg, audio mp3/ogg/m4a. Nazwy plików najlepiej unikalne, bo przy wczytywaniu pojedynczych plików dopasowanie idzie po nazwie. Panel w poczekalni pokazuje, których plików brakuje.

Odcinek: `episode` (numer w czołówce; bez tego pola brany z nazwy pliku `odcinek-2.json`) i `subtitle` (podpis pod logo). Własne zasady: `rules` jako lista `{ "title", "board": [krótkie linijki na stream], "host": "tekst do przeczytania" }`; bez tego pola panel układa zasady sam na podstawie zestawu (rundy, stawki, pola „wszystko albo nic”, finał, czy są media).
Finał: `category`, `q`, `a`. Liczba pól „wszystko albo nic” na rundę: `dailyDoubles` (domyślnie 1 i 2).

Prawdziwych pytań nie wrzucamy do repo (`pytania/*.json` poza przykładem jest w `.gitignore`).

## Technika

- Łączność: WebRTC przez [PeerJS](https://peerjs.com). Publiczny serwer PeerJS służy tylko do zestawienia połączenia.
- Do testów lokalnych można podać własny serwer: `host.html?peer=127.0.0.1:9000`.
- Biblioteki są w `vendor/` (PeerJS 1.5.4, qrcode-generator 1.4.4), więc strona nie zależy od CDN.
- Stan gry zapisuje się w przeglądarce prowadzącego, odświeżenie panelu go nie kasuje.
