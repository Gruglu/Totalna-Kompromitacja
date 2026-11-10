# Totalna Kompromitacja

Nerdowski teleturniej w stylu Jeopardy na Discorda. Statyczna strona (GitHub Pages), bez serwera.

## Jak grać

Bez streamowania: każdy gracz widzi planszę u siebie, a obrazki i muzyka z pytań grają na jego urządzeniu.

1. Prowadzący otwiera `host.html` (panel). Po prawej jest podgląd **Co widzą gracze**: rozmiar (mały, średni, duży), dźwięk u prowadzącego (włącz, żeby słyszeć muzykę z pytań razem z graczami) i widok telefonu, żeby sprawdzić, jak wygląda plansza w pionie.
2. Gracze wchodzą w link (`play.html?r=KOD`) i wpisują nick:
   - **komputer**: plansza 16:9 i panel z buzzerem z boku, spacja = buzzer, `F` = pełny ekran,
   - **telefon**: plansza na górze, buzzer pod nią; obrazek z pytania dotyka się, żeby go powiększyć,
   - **komputer + telefon**: na komputerze „Telefon jako buzzer” pokazuje kod QR, telefon po zeskanowaniu jest buzzerem tego samego gracza (sam przycisk, plansza zostaje na komputerze),
   - **Tylko oglądam**: sama plansza, bez grania (np. telewizor albo widz).
   Przy pierwszym dotknięciu urządzenie włącza dźwięk.
3. **Wczytaj folder**: folder z pytaniami (plik JSON + podfolder `media/`). Jeśli w folderze jest kilka JSON-ów, panel zapyta, który gramy. **Wczytaj pliki** przyjmuje sam JSON albo JSON razem z plikami mediów. Pytania i media leżą tylko w przeglądarce prowadzącego (localStorage + IndexedDB), nie trafiają do repo.
4. Urządzenia graczy pobierają media od prowadzącego zaraz po wejściu (P2P, przez to samo połączenie co buzzery). Pliki idą pod losowymi nazwami i zaszyfrowane, a klucz do danego obrazka czy klipu przychodzi dopiero razem z pytaniem, więc nikt nie podejrzy ich wcześniej w narzędziach przeglądarki. Panel pokazuje przy każdym graczu „media 12/14” i przy pytaniu z muzyką, u ilu graczy gra.
5. Start odcinka: **Czołówka** (animacja z muzyką u graczy, ok. 11 s), potem **Zasady** (prowadzący czyta tekst z panelu, plansza pokazuje skrót), potem pierwsza runda.

**Osobne okno planszy** (przycisk u góry) dalej istnieje, np. na drugi monitor albo gdyby ktoś jednak chciał streamować. Wtedy wyłącz dźwięk w podglądzie, żeby muzyka nie grała podwójnie.

## Koło fortuny: pytania od graczy

1. **Gracze piszą pytania sami**: w poczekalni pod buzzerem każdy ma „Dodaj pytanie na koło” (po 2 na osobę, pytanie, odpowiedź, opcjonalnie inne dobre odpowiedzi). Może je poprawić albo usunąć, dopóki nie padły. Widzi je tylko prowadzący.
2. **Prowadzący przegląda** listę w poczekalni (panel „Koło fortuny”): widzi, kto ile wysłał, może poprawić, usunąć pytanie z czapy albo dopisać pytanie za kogoś (np. przysłane na Discordzie).
3. **Na planszy** przy starcie losują się ukryte pola z kołem (jak „wszystko albo nic”, nigdy w najtańszym rzędzie). Domyślnie pytania graczy rozkładają się po równo na rundy; w panelu pole ma znaczek **KOŁO**. Gdy po rundach zostaną pytania, pod planszą jest **Dodatkowy obrót koła** za wybraną stawkę.
4. **Kręcenie**: kto trafi na pole, kręci (`Enter` w panelu). Koło kręci się u wszystkich na urządzeniach, segmenty pokazują autorów pytań. Pytanie widzi tylko prowadzący, gracze dopiero po **Pokaż pytanie**.
5. **Własne pytanie**: gdy koło wskaże pytanie wybierającego, ten na telefonie wybiera, komu je oddać, albo klika **Losuj osobę** (losowanie widać na planszy). Prowadzący może to samo kliknąć w panelu.
6. **Punkty**: odpowiada jedna osoba, bez buzzerów (zegar jak przy „wszystko albo nic”, `Spacja`). Dobrze: wartość pola, źle: tyle samo na minus. Gdy ktoś poległ albo nikt nie wiedział, panel proponuje **Premię dla autora** (połowa stawki); klikasz tylko, jeśli pytanie było uczciwe.

Pytania na koło zostają przy „Nowa gra” (wylosowane wracają na koło); **Wyczyść koło** usuwa wszystkie. W pliku z pytaniami można też dać gotowe pytania (`wheel`) i liczbę pól z kołem na rundę (`wheelFields`), patrz niżej.

## Po odcinku: Hall of Shame, kara, ranking sezonu

- **Hall of Shame**: w trakcie pytania, odpowiedzi albo odsłaniania finału klawisz `H` (albo kliknięcie w pole „Hall of Shame”) otwiera wpis. Gracz jest podpowiedziany (ten, kto właśnie odpowiadał), wpisujesz, co powiedział, `Enter` zapisuje. Po odcinku wybierasz, która odpowiedź idzie na slajd, reszta pokazuje się jako nominacje.
- **Kara**: zwycięzca wybiera ostatniemu miejscu nick i avatar na Discordzie na 7 dni. Panel podpowiada pierwsze i ostatnie miejsce (przy remisie klikasz ręcznie), a nowy nick wpisujesz, gdy zwycięzca go wymyśli. Domyślne zasady mają o tym osobny slajd.
- **Ranking sezonu**: „Zapisz odcinek do sezonu” na ekranie końcowym dopisuje wyniki (ten sam numer odcinka nadpisuje stary zapis). Suma punktów ze wszystkich odcinków, top 3 gra w finale sezonu. Sezon leży w przeglądarce prowadzącego (nie znika przy „Nowa gra”), a **Eksport JSON** / **Import JSON** przenosi go na inny komputer. Gracze łączą się po nicku. Ranking można pokazać graczom także z poczekalni.

Na ekranie końcowym przełączasz, co widzą gracze: wyniki odcinka, Hall of Shame, kara, ranking sezonu.

## Mówiące awatary z Discorda (opcjonalnie)

Awatar każdego gracza przy nicku na planszy, podświetlany i z otwartymi ustami, kiedy gracz mówi na kanale głosowym. Działa przez małego bota Discorda uruchamianego u prowadzącego na czas gry (folder `bot/`, instrukcja w [bot/README.md](bot/README.md)). Panel łączy się z botem i przekazuje awatary i to, kto mówi, na urządzenia graczy. Bez bota plansza wygląda jak zwykle.

## Skróty w panelu

`Spacja` otwórz buzzery · `D` dobrze · `Z` źle · `P` połowa · `N` nikt nie wie · `Enter` dalej · `1–6` zgłoszenie ręczne (gdy komuś nie działa telefon) · `Ctrl+Z` cofnij · `M` muzyka graj/pauza · `R` muzyka od początku · `H` Hall of Shame · `←`/`→` poprzednia/następna zasada.

## Własne pytania bez pisania JSON-a: edytor

`edytor.html` (na stronie głównej „Układam pytania”, w panelu przycisk **Edytor pytań**) to edytor zestawu w przeglądarce, dla każdego, kto chce zagrać swoimi pytaniami:

- rundy (do 4) z nazwą, stawkami, liczbą pól „wszystko albo nic” i pól z kołem fortuny, kategorie (do 8) i wiersze (do 10) dodawane i usuwane jak na planszy,
- pytanie: treść, odpowiedź, inne dobre odpowiedzi, ciekawostka dla prowadzącego, opcjonalnie obrazek z pytaniem, obrazek po odpowiedzi i klip audio (link `https://…` albo ścieżka `media/plik.jpg` do wczytania folderem w panelu), z podglądem,
- finał (opcjonalnie), nazwa na logo planszy, podpis w czołówce, numer odcinka,
- lista braków („Gotowość”), kliknięcie przenosi do pola,
- kilka zestawów naraz, zapis automatyczny w tej przeglądarce (localStorage), **Eksportuj JSON** / **Importuj JSON** w formacie poniżej, **Weź z panelu** robi kopię zestawu wczytanego w panelu,
- **Zagraj tym zestawem** sprawdza zestaw i wczytuje go do panelu prowadzącego (do otwartego w innej karcie albo otwiera panel).

Skróty: `Ctrl+Enter` następne pytanie, `Ctrl+Shift+Enter` poprzednie, `Ctrl+S` zapis.

## Plik z pytaniami

Wzór: `pytania/przyklad.json`. Każda runda ma `values` (stawki) i `categories`; każda kategoria ma tyle pytań, ile stawek.
Pytanie: `q` (treść), `a` (odpowiedź), opcjonalnie `alt` (inne akceptowane odpowiedzi), `note` (ciekawostka dla prowadzącego) i media:

- `image`: obrazek pokazywany razem z pytaniem,
- `answerImage`: obrazek pokazywany dopiero z odpowiedzią,
- `audio`: klip, który prowadzący puszcza z panelu (gra na urządzeniach graczy), `audioStart` i `audioEnd` w sekundach wycinają fragment.

Ścieżki mediów są względne do pliku JSON (`media/kadr.jpg`) albo to pełne adresy `https://`. Obrazki jpg/png/webp/svg, audio mp3/ogg/m4a. Nazwy plików najlepiej unikalne, bo przy wczytywaniu pojedynczych plików dopasowanie idzie po nazwie. Panel w poczekalni pokazuje, których plików brakuje.

Odcinek: `episode` (numer w czołówce; bez tego pola brany z nazwy pliku `odcinek-2.json`) i `subtitle` (podpis pod logo). Własne zasady: `rules` jako lista `{ "title", "board": [krótkie linijki na planszę], "host": "tekst do przeczytania" }`; bez tego pola panel układa zasady sam na podstawie zestawu (rundy, stawki, pola „wszystko albo nic”, finał, czy są media).
Finał: `category`, `q`, `a`. Liczba pól „wszystko albo nic” na rundę: `dailyDoubles` (domyślnie 1 i 2).
Koło fortuny: `wheel` to lista `{ "author", "q", "a", "alt", "note" }` (mogą też mieć media jak zwykłe pytania), a `wheelFields` w rundzie ustala liczbę pól z kołem (bez tego pola: pytania graczy po równo na rundy). Pytania, które gracze wpiszą na telefonach, nie trafiają do pliku, leżą w stanie gry u prowadzącego.
Kategoria w ciemno: `blind` to lista `{ "category", "q", "a", "alt", "note" }` (mogą mieć media). Na planszy są ukryte pola (domyślnie 1 na rundę, zmienisz to przez `blindFields` w rundzie). Pole zabiera pytanie z planszy i zamiast niego losuje pytanie z puli, za podwójną stawkę, z buzzerami dla wszystkich. Gracze widzą nazwę kategorii dopiero razem z pytaniem.
Kadr z gry: `zoom` w pytaniu to lista obrazków od najbliższego zbliżenia do pełnego kadru, np. `["media/x-1.jpg", "media/x-2.jpg", "media/x-3.jpg"]`. Prowadzący oddala klawiszem **E** (gdy nikt nie odpowiada). Stawka maleje z etapem: 100%, 2/3, 1/3 (zaokrąglone do 50); inne mnożniki w rundzie przez `zoomPoints`, np. `[1, 0.5, 0.25]`. Po odpowiedzi widać `answerImage` albo pełny kadr.

Prawdziwych pytań nie wrzucamy do repo (`pytania/*.json` poza przykładem jest w `.gitignore`).

## Technika

- Łączność: WebRTC przez [PeerJS](https://peerjs.com). Publiczny serwer PeerJS służy tylko do zestawienia połączenia.
- Do testów lokalnych można podać własny serwer: `host.html?peer=127.0.0.1:9000`.
- Biblioteki są w `vendor/` (PeerJS 1.5.4, qrcode-generator 1.4.4), więc strona nie zależy od CDN.
- Stan gry zapisuje się w przeglądarce prowadzącego, odświeżenie panelu go nie kasuje.
