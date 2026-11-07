# Mówiące awatary (bot Discorda)

Każdy gracz ma na streamie swój awatar przy nicku. Kiedy mówi na kanale głosowym, awatar podświetla się na bursztynowo i podmienia na drugi obrazek (np. otwarte usta).

Bot działa **tylko u prowadzącego, na czas streamu**: siedzi na kanale głosowym wyciszony, niczego nie nagrywa, dostaje od Discorda wyłącznie sygnał „ten ktoś zaczął/przestał mówić” i przekazuje go do okna streamu na tym samym komputerze (`ws://127.0.0.1:7337`). Hosting nie jest potrzebny, strona dalej jest statyczna. Bez bota plansza wygląda jak zwykle.

## Jednorazowo: przygotowanie

### 1. Node.js

Zainstaluj Node.js w wersji LTS (22 albo nowszej) z <https://nodejs.org>. Sprawdzenie w terminalu: `node -v`.

### 2. Bot w Discord Developer Portal (ok. 5 minut)

1. Wejdź na <https://discord.com/developers/applications> → **New Application**, nazwa np. „Kamera studyjna” (tak będzie się nazywał na kanale).
2. Zakładka **Bot** → **Reset Token** → skopiuj token. To hasło bota: nie wysyłaj go nikomu i nie wrzucaj do repo.
   Żadnych „Privileged Gateway Intents” nie trzeba włączać.
3. Zakładka **OAuth2** → **URL Generator**: w *Scopes* zaznacz `bot`, w *Bot Permissions* zaznacz **View Channels** i **Connect**. Skopiuj link na dole, otwórz go i dodaj bota na swój serwer.

### 3. Pliki bota

W folderze `bot/` (najprościej: pobierz repo jako ZIP albo `git clone`):

1. Skopiuj `config.przyklad.json` jako `config.json` i uzupełnij:
   - `token`: token z punktu 2,
   - `kanal`: nazwa kanału głosowego, na którym gracie (albo jego ID),
   - `gracze`: po jednym wpisie na osobę:
     - `discord`: **nazwa użytkownika** na Discordzie (ta z małej litery, np. `kamil_123`) albo ID użytkownika. Nie nick z serwera, bo przegrany dostaje karny nick na tydzień, a nazwa użytkownika się nie zmienia.
     - `nick`: nick, którym gracz wchodzi do gry z telefonu. Jeśli ktoś bywa różnie podpisany, daj listę: `["Marek", "Mareczek"]`. Wielkość liter i polskie znaki nie mają znaczenia.
     - `awatar`: obrazek normalny, `mowi`: obrazek, gdy mówi.
2. Wrzuć obrazki do `bot/awatary/` (folder jest ignorowany przez git). Najlepiej kwadratowe, 256×256 px, PNG/JPG/WEBP/GIF (animowany GIF też zadziała). Brakujący obrazek bot zastąpi literką, żeby dało się sprawdzić układ.
3. W terminalu w folderze `bot/` (Windows: w folderze Shift + prawy klik → „Otwórz w terminalu”): `npm install`.

## Na każdym streamie

1. W folderze `bot/`: `npm start`. Bot loguje się i wchodzi na kanał. W konsoli widać, kogo rozpoznał („Rozpoznany: …”) i kogo pominął.
2. Otwórz panel i **Ekran streamu** jak zwykle. Okno streamu samo łączy się z botem (kolejność uruchamiania nie ma znaczenia, łączy się ponownie co kilka sekund).
3. Jeśli przeglądarka zapyta o dostęp do aplikacji lub urządzeń na tym komputerze, kliknij **Zezwól**.
4. W poczekalni panelu pojawi się linijka „Mówiące awatary: bot Discorda połączony” i lista graczy, którym nie dopasował się awatar (wtedy popraw `nick` w `config.json` i zrestartuj bota).
5. Po streamie: `Ctrl+C` w oknie bota, wychodzi z kanału.

## Próba bez Discorda

`npm test` uruchamia bota bez logowania: awatary z `config.json` „gadają” losowo. Dobre do sprawdzenia obrazków na planszy (dodaj w panelu graczy bez telefonu o tych samych nickach).

## Gdy coś nie działa

- **„Nie widzę kanału głosowego”**: bot wypisze listę kanałów, które widzi; skopiuj nazwę albo ID do `kanal`. Jeśli lista jest pusta, bot nie jest na serwerze (punkt 2.3).
- **Awatar się nie rusza**: sprawdź w konsoli bota, czy osoba jest „Rozpoznana”. Jeśli „pomijam”, wpisz w `discord` nazwę użytkownika, którą wypisał bot.
- **Port zajęty**: bot już działa w innym oknie. Inny port: `"port": 7338` w `config.json` i ekran streamu z `board.html?bot=7338`.
- Wyłączenie awatarów na jeden stream: po prostu nie uruchamiaj bota (albo `board.html?bot=0`).
- Usta reagują z opóźnieniem ok. 0,1–0,3 s, tak podaje to Discord. Jak długo zostają otwarte po ostatnim dźwięku, ustawia `"przytrzymaj": 250` (ms) w `config.json`.
