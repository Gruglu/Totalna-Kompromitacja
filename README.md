# Totalna Kompromitacja

Nerdowski teleturniej w stylu Jeopardy na Discorda. Statyczna strona (GitHub Pages), bez serwera.

## Jak grać

1. Prowadzący otwiera `host.html` (panel, tego nie streamuje).
2. W panelu klika **Ekran streamu**, w nowym oknie klika raz (dźwięk), `F` = pełny ekran. To okno udostępnia na Discordzie.
3. Gracze wchodzą z telefonu w link albo skanują QR ze streamu (`play.html?r=KOD`) i wpisują nick.
4. **Wczytaj pytania**: własny plik JSON. Pytania zostają tylko w przeglądarce prowadzącego, nie trafiają do repo.

## Skróty w panelu

`Spacja` otwórz buzzery · `D` dobrze · `Z` źle · `P` połowa · `N` nikt nie wie · `Enter` dalej · `1–6` zgłoszenie ręczne (gdy komuś nie działa telefon) · `Ctrl+Z` cofnij.

## Plik z pytaniami

Wzór: `pytania/przyklad.json`. Każda runda ma `values` (stawki) i `categories`; każda kategoria ma tyle pytań, ile stawek.
Pytanie: `q` (treść), `a` (odpowiedź), opcjonalnie `alt` (inne akceptowane odpowiedzi), `note` (ciekawostka dla prowadzącego), `image` (adres obrazka).
Finał: `category`, `q`, `a`. Liczba pól „wszystko albo nic” na rundę: `dailyDoubles` (domyślnie 1 i 2).

Prawdziwych pytań nie wrzucamy do repo (`pytania/*.json` poza przykładem jest w `.gitignore`).

## Technika

- Łączność: WebRTC przez [PeerJS](https://peerjs.com). Publiczny serwer PeerJS służy tylko do zestawienia połączenia.
- Do testów lokalnych można podać własny serwer: `host.html?peer=127.0.0.1:9000`.
- Biblioteki są w `vendor/` (PeerJS 1.5.4, qrcode-generator 1.4.4), więc strona nie zależy od CDN.
- Stan gry zapisuje się w przeglądarce prowadzącego, odświeżenie panelu go nie kasuje.
