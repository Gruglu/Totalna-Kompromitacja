// Łączność P2P przez PeerJS (WebRTC). Publiczny serwer PeerJS służy tylko do
// zestawienia połączenia, potem dane lecą bezpośrednio telefon <-> komputer prowadzącego.
/* global Peer */

const PREFIX = 'totalna-kompromitacja-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // bez I i O, żeby nie myliły się z 1 i 0

// Opcjonalny własny serwer sygnalizacyjny: ?peer=host:port (do testów lokalnych).
export function peerOptions() {
  const p = new URLSearchParams(location.search).get('peer');
  if (!p) return { debug: 1 };
  const [host, port] = p.split(':');
  return { debug: 1, host, port: Number(port) || 9000, path: '/', secure: location.protocol === 'https:' };
}

export function randomCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function normalizeCode(c) {
  return String(c || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 4);
}

// ---------- prowadzący ----------

export function hostRoom(code, { onStatus, onJoin, onMessage, onLeave }) {
  let peer = null;
  let destroyed = false;
  const conns = new Map(); // conn.peer -> { conn, token, lastSeen }

  function start() {
    onStatus?.('connecting');
    peer = new Peer(PREFIX + code, peerOptions());
    peer.on('open', () => onStatus?.('open'));
    peer.on('connection', (conn) => {
      const entry = { conn, token: null, lastSeen: Date.now() };
      conns.set(conn.peer, entry);
      conn.on('data', (msg) => {
        entry.lastSeen = Date.now();
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'pong') return;
        if (msg.t === 'join') {
          entry.token = String(msg.token || '').slice(0, 64);
          onJoin?.(entry.token, String(msg.name || '').slice(0, 24), conn);
          return;
        }
        if (entry.token) onMessage?.(entry.token, msg);
      });
      const drop = () => {
        if (conns.get(conn.peer) !== entry) return;
        conns.delete(conn.peer);
        if (entry.token && ![...conns.values()].some((e) => e.token === entry.token)) onLeave?.(entry.token);
      };
      conn.on('close', drop);
      conn.on('error', drop);
    });
    peer.on('disconnected', () => {
      if (destroyed) return;
      onStatus?.('reconnecting');
      setTimeout(() => !destroyed && !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', (e) => {
      if (destroyed) return;
      if (e.type === 'unavailable-id') {
        // stara sesja z tym kodem jeszcze wisi na serwerze; spróbuj ponownie
        onStatus?.('id-taken');
        peer.destroy();
        setTimeout(() => !destroyed && start(), 4000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) {
        onStatus?.('reconnecting');
      } else {
        console.warn('PeerJS:', e.type, e);
      }
    });
  }
  start();

  // pingi, żeby wykryć telefony, które zniknęły bez pożegnania
  const ping = setInterval(() => {
    const t = Date.now();
    for (const [id, e] of conns) {
      if (t - e.lastSeen > 12000) {
        e.conn.close();
        conns.delete(id);
        if (e.token && ![...conns.values()].some((x) => x.token === e.token)) onLeave?.(e.token);
      } else if (e.conn.open) e.conn.send({ t: 'ping' });
    }
  }, 3000);

  return {
    sendTo(token, msg) {
      for (const e of conns.values()) if (e.token === token && e.conn.open) e.conn.send(msg);
    },
    tokens() {
      return [...new Set([...conns.values()].map((e) => e.token).filter(Boolean))];
    },
    kick(token) {
      for (const [id, e] of conns) if (e.token === token) {
        e.conn.send({ t: 'kicked' });
        setTimeout(() => e.conn.close(), 200);
        conns.delete(id);
      }
    },
    destroy() {
      destroyed = true;
      clearInterval(ping);
      peer?.destroy();
    },
  };
}

// ---------- gracz ----------

export function joinRoom(code, token, name, { onStatus, onMessage }) {
  let peer = null;
  let conn = null;
  let destroyed = false;
  let lastSeen = 0;
  let retry = null;

  function schedule(ms = 2000) {
    if (destroyed || retry) return;
    retry = setTimeout(() => {
      retry = null;
      connect();
    }, ms);
  }

  function connect() {
    if (destroyed) return;
    onStatus?.('connecting');
    if (!peer || peer.destroyed) {
      peer = new Peer(peerOptions());
      peer.on('open', () => openConn());
      peer.on('disconnected', () => !destroyed && !peer.destroyed && peer.reconnect());
      peer.on('error', (e) => {
        if (e.type === 'peer-unavailable') onStatus?.('no-room');
        else onStatus?.('error');
        schedule(3000);
      });
    } else if (peer.open) openConn();
  }

  function openConn() {
    try {
      conn?.close();
    } catch {}
    conn = peer.connect(PREFIX + code, { reliable: true });
    const c = conn;
    c.on('open', () => {
      lastSeen = Date.now();
      onStatus?.('open');
      c.send({ t: 'join', token, name });
    });
    c.on('data', (msg) => {
      lastSeen = Date.now();
      if (msg?.t === 'ping') return c.send({ t: 'pong' });
      if (msg?.t === 'kicked') {
        destroyed = true;
        onStatus?.('kicked');
        return;
      }
      onMessage?.(msg);
    });
    c.on('close', () => {
      if (c !== conn) return;
      onStatus?.('lost');
      schedule();
    });
  }

  const watchdog = setInterval(() => {
    if (destroyed) return;
    if (conn?.open && Date.now() - lastSeen > 10000) {
      onStatus?.('lost');
      try {
        conn.close();
      } catch {}
      schedule(500);
    }
  }, 2000);

  connect();

  return {
    send(msg) {
      if (conn?.open) {
        conn.send(msg);
        return true;
      }
      return false;
    },
    rename(n) {
      name = n;
      this.send({ t: 'join', token, name });
    },
    destroy() {
      destroyed = true;
      clearInterval(watchdog);
      clearTimeout(retry);
      peer?.destroy();
    },
  };
}
