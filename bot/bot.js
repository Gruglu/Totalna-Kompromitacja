// Mówiące awatary: bot siedzi na kanale głosowym Discorda (wyciszony, nic nie nagrywa),
// dostaje sygnały „ktoś mówi / przestał mówić” i przekazuje je do ekranu streamu
// przez lokalne połączenie ws://127.0.0.1:PORT. Działa tylko na komputerze prowadzącego.
//
//   npm start          bot na Discordzie
//   npm test           tryb próbny bez Discorda: awatary z config.json „gadają” losowo

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEST = process.argv.includes('--test');
const CONFIG = resolve(HERE, process.env.CONFIG || 'config.json');

function log(...a) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}]`, ...a);
}
function die(msg) {
  console.error('\n  ' + msg + '\n');
  process.exit(1);
}

// ---------- konfiguracja ----------

if (!existsSync(CONFIG)) die(`Brak pliku ${CONFIG}. Skopiuj config.przyklad.json jako config.json i uzupełnij.`);
let cfg;
try {
  cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
} catch (e) {
  die(`config.json ma błąd składni: ${e.message}`);
}
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
const PORT = Number(cfg.port) || 7337;
const HOLD_MS = Number(cfg.przytrzymaj) || 250; // ile ms usta zostają otwarte po ostatnim dźwięku
const players = (cfg.gracze || []).map((g, i) => ({
  key: 'g' + i,
  discord: String(g.discord || '').trim(),
  nicks: [].concat(g.nick || []).map(String).filter(Boolean),
  closed: image(g.awatar, g.nick, false),
  open: image(g.mowi, g.nick, true),
}));
if (!players.length) die('W config.json nie ma żadnego gracza w "gracze".');
for (const p of players) if (!p.nicks.length) die(`Gracz "${p.discord}" nie ma pola "nick" (nick, którym wchodzi do gry).`);

// Obrazek jako data URL. Brak pliku = zastępczy awatar z inicjałem (żeby dało się sprawdzić układ).
function image(file, nick, open) {
  if (file) {
    const path = resolve(dirname(CONFIG), file);
    const mime = MIME[extname(path).toLowerCase()];
    if (!mime) die(`Nieobsługiwany format obrazka: ${file} (png, jpg, webp, gif, svg).`);
    if (existsSync(path)) return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
    console.warn(`  uwaga: brak pliku ${path}, używam zastępczego awatara`);
  }
  const ch = String([].concat(nick)[0] || '?').trim().charAt(0).toUpperCase() || '?';
  const mouth = open
    ? '<ellipse cx="32" cy="47" rx="9" ry="7" fill="#120d07"/>'
    : '<rect x="22" y="46" width="20" height="3" fill="#120d07"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#ffb22e"/><text x="32" y="34" text-anchor="middle" font-family="monospace" font-size="26" font-weight="700" fill="#120d07">${ch.replace(/[<&>]/g, '')}</text>${mouth}</svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

// ---------- serwer dla ekranu streamu ----------

const speaking = new Set(); // klucze graczy, którzy teraz mówią
const offTimers = new Map();
const clients = new Set();

function okOrigin(origin) {
  if (!origin || origin === 'null') return true; // plik otwarty lokalnie
  try {
    const h = new URL(origin).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.github.io') || (cfg.originy || []).includes(origin);
  } catch {
    return false;
  }
}

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT, verifyClient: ({ origin }) => okOrigin(origin) });
wss.on('error', (e) => {
  if (e.code === 'EADDRINUSE') die(`Port ${PORT} jest zajęty. Czy bot nie jest już uruchomiony w innym oknie?`);
  die(String(e));
});
wss.on('listening', () => log(`Ekran streamu może się łączyć: ws://127.0.0.1:${PORT}`));
wss.on('connection', (ws) => {
  clients.add(ws);
  log('Ekran streamu podłączony.');
  ws.send(JSON.stringify({ t: 'hello', players: players.map(({ key, nicks, closed, open }) => ({ key, nicks, closed, open })), speaking: [...speaking] }));
  ws.on('close', () => {
    clients.delete(ws);
    log('Ekran streamu rozłączony.');
  });
  ws.on('error', () => {});
});
// ping co 20 s, żeby przeglądarka nie uznała połączenia za martwe
setInterval(() => {
  for (const ws of clients) ws.ping();
}, 20000);

function send(msg) {
  const s = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === 1) ws.send(s);
}

function setSpeaking(key, on) {
  clearTimeout(offTimers.get(key));
  offTimers.delete(key);
  if (on) {
    if (speaking.has(key)) return;
    speaking.add(key);
    send({ t: 'speak', key, on: true });
  } else {
    // krótka zwłoka, żeby usta nie migały między słowami
    offTimers.set(
      key,
      setTimeout(() => {
        offTimers.delete(key);
        if (!speaking.delete(key)) return;
        send({ t: 'speak', key, on: false });
      }, HOLD_MS)
    );
  }
}

// ---------- tryb próbny ----------

if (TEST) {
  log(`Tryb próbny: ${players.length} graczy gada losowo. Otwórz ekran streamu, Ctrl+C kończy.`);
  for (const p of players) {
    const loop = () => {
      const talk = Math.random() < 0.45;
      setSpeaking(p.key, talk);
      setTimeout(loop, talk ? 400 + Math.random() * 1800 : 800 + Math.random() * 3000);
    };
    setTimeout(loop, Math.random() * 2000);
  }
} else {
  await startDiscord();
}

// ---------- Discord ----------

async function startDiscord() {
  if (!cfg.token || /TU_WKLEJ/.test(cfg.token)) die('Wklej token bota do config.json (pole "token"). Instrukcja w bot/README.md.');
  if (!cfg.kanal) die('Uzupełnij "kanal" w config.json: ID albo nazwa kanału głosowego.');

  const { Client, GatewayIntentBits, ChannelType, Events } = await import('discord.js');
  const voice = await import('@discordjs/voice');
  const { joinVoiceChannel, VoiceConnectionStatus, entersState } = voice;

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  const norm = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

  const byUser = new Map(); // ID użytkownika Discorda -> klucz gracza (albo null = nie gra)
  let channel = null;
  let connection = null;
  let leaving = false;

  // Dopasowanie użytkownika do wpisu w config: po ID, nazwie użytkownika, nazwie wyświetlanej albo nicku na serwerze.
  async function keyFor(userId) {
    if (byUser.has(userId)) return byUser.get(userId);
    let key = players.find((p) => p.discord === userId)?.key ?? null;
    if (!key) {
      let member = channel?.guild.members.cache.get(userId);
      if (!member) member = await channel?.guild.members.fetch(userId).catch(() => null);
      const names = [member?.user.username, member?.user.globalName, member?.nickname].filter(Boolean).map(norm);
      key = players.find((p) => p.discord && names.includes(norm(p.discord)))?.key ?? null;
      const label = member ? `${member.displayName} (@${member.user.username}, ${userId})` : userId;
      if (key) log(`Rozpoznany: ${label} -> ${players.find((p) => p.key === key).nicks[0]}`);
      else log(`Nie ma go w config.json, pomijam: ${label}`);
    }
    byUser.set(userId, key);
    return key;
  }

  function findChannel() {
    const want = String(cfg.kanal);
    const all = client.channels.cache.filter((c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice);
    const hit = all.get(want) || all.find((c) => norm(c.name) === norm(want));
    if (!hit) {
      const list = all.map((c) => `    ${c.name}  (${c.id}, serwer ${c.guild.name})`).join('\n');
      die(`Nie widzę kanału głosowego "${want}". Kanały, które widzi bot:\n${list || '    (żadnych, czy bot jest na serwerze?)'}`);
    }
    return hit;
  }

  async function join() {
    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false, // musi „słyszeć”, żeby dostawać sygnały mówienia
      selfMute: true,
    });
    connection.on('error', (e) => log('Błąd połączenia głosowego:', e.message));
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (leaving) return;
      try {
        // Discord czasem przełącza serwer głosowy; jeśli w 5 s nie wróci, łączymy od nowa
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        log('Rozłączony z kanału, łączę ponownie…');
        connection.destroy();
        setTimeout(() => !leaving && join().catch((e) => log('Nie udało się wrócić na kanał:', e.message)), 3000);
      }
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 20000);
    log(`Na kanale „${channel.name}”. Słucham, kto mówi.`);
    const sp = connection.receiver.speaking;
    sp.on('start', async (id) => {
      const key = await keyFor(id);
      if (key) setSpeaking(key, true);
    });
    sp.on('end', async (id) => {
      const key = await keyFor(id);
      if (key) setSpeaking(key, false);
    });
  }

  client.once(Events.ClientReady, async () => {
    log(`Zalogowany jako ${client.user.tag}.`);
    channel = findChannel();
    const here = channel.members.map((m) => `${m.displayName} (@${m.user.username})`);
    if (here.length) log(`Na kanale są: ${here.join(', ')}`);
    try {
      await join();
    } catch (e) {
      die(`Nie udało się wejść na kanał (${e.message}). Czy bot ma uprawnienia „Połącz” i „Wyświetl kanał”?`);
    }
  });

  // ktoś wyszedł z kanału albo się wyciszył: zamknij mu usta od razu
  client.on(Events.VoiceStateUpdate, async (oldS, newS) => {
    if (!channel || newS.id === client.user.id) return;
    const gone = oldS.channelId === channel.id && newS.channelId !== channel.id;
    const muted = newS.channelId === channel.id && (newS.selfMute || newS.serverMute);
    if (!gone && !muted) return;
    const key = await keyFor(newS.id);
    if (key) setSpeaking(key, false);
  });

  const quit = () => {
    leaving = true;
    log('Wychodzę z kanału.');
    connection?.destroy();
    client.destroy();
    process.exit(0);
  };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);

  try {
    await client.login(cfg.token);
  } catch (e) {
    if (e.code === 'TokenInvalid') die('Discord nie przyjął tokena. Skopiuj go jeszcze raz z Developer Portal (Bot → Reset Token).');
    die(`Nie mogę połączyć się z Discordem (${e.message}). Sprawdź internet.`);
  }
}
