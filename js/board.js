// Osobne okno planszy (board.html) i podgląd w panelu (board.html?preview).
// Dostaje widok od panelu prowadzącego przez BroadcastChannel i rysuje go wspólną planszą.
// Gracze widzą to samo u siebie (play.html), więc to okno jest opcjonalne:
// przydaje się na drugi monitor albo gdyby ktoś jednak chciał streamować.
import * as stage from './stage.js';
import * as sound from './sound.js';
import * as media from './media.js';
import * as avatars from './avatars.js';

const params = new URLSearchParams(location.search);
const PREVIEW = params.has('preview');
const chan = new BroadcastChannel('totalna-kompromitacja');
const $frame = document.querySelector('.frame');
let got = false;

stage.init(document.getElementById('stage'), {
  sound: !PREVIEW,
  resolve: (src) => media.resolve(src),
  onMediaReset: () => media.resetCache(),
  report: (st) => chan.postMessage({ ...st, from: PREVIEW ? 'preview' : 'window' }),
});

chan.onmessage = (e) => {
  const m = e.data;
  if (m?.t === 'state') {
    got = true;
    stage.update(m);
  } else if (m?.t === 'audio' && m.from !== (PREVIEW ? 'preview' : 'window')) {
    stage.setAudioStat(m);
  }
};
chan.postMessage({ t: 'hello' });
setInterval(() => !got && chan.postMessage({ t: 'hello' }), 1000);

// mówiące awatary z bota Discorda (bot/); bez bota plansza wygląda jak zwykle
avatars.start(() => stage.refresh());

// Panel steruje podglądem bezpośrednio (to samo źródło): dźwięk i wygląd telefonu.
window.__preview = {
  setSound(on) {
    if (on) stage.unlock();
    stage.setSound(on);
  },
  unlock: () => stage.unlock(),
  setPhone(on) {
    document.body.classList.toggle('phone', !!on);
    $frame.classList.toggle('compact', !!on);
    stage.refresh();
  },
};

if (!PREVIEW) {
  // Chrome i Edge na Windows przestają rysować okno, które jest zakryte innym oknem,
  // a Discord udostępniający to okno pokazuje wtedy zamrożony obraz. Karta, która jest
  // nagrywana, jest dla przeglądarki zawsze „widoczna”, więc plansza udostępnia sama
  // siebie. Strumień nigdzie nie wychodzi, tylko trzyma okno przy życiu.
  const CAN_KEEP_ALIVE = !!navigator.mediaDevices?.getDisplayMedia && !!navigator.userAgentData;
  let keepStream = null;
  let keepAsked = false;
  const keepAlive = async () => {
    if (!CAN_KEEP_ALIVE || keepStream || keepAsked) return;
    keepAsked = true;
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 1, width: 160, height: 90 },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
        monitorTypeSurfaces: 'exclude',
      });
      const tr = s.getVideoTracks()[0];
      if (tr?.getSettings().displaySurface && tr.getSettings().displaySurface !== 'browser') {
        s.getTracks().forEach((x) => x.stop());
        throw new Error('not-tab');
      }
      keepStream = s;
      window.__keepAlive = s;
      tr.onended = () => {
        keepStream = null;
        notice('Plansza może zamarzać w tle', 'kliknij w nią, żeby znowu udostępnić tę kartę');
      };
    } catch {
      notice('Plansza może zamarzać w tle', 'kliknij w nią i wybierz „ta karta”, albo nie zakrywaj tego okna');
    } finally {
      keepAsked = false;
    }
  };

  let noticeEl = null;
  const notice = (title, sub) => {
    noticeEl?.remove();
    noticeEl = document.createElement('div');
    noticeEl.className = 'keep-note';
    noticeEl.innerHTML = `<b>${title}</b><small>${sub}</small>`;
    document.body.appendChild(noticeEl);
    const el = noticeEl;
    setTimeout(() => el.remove(), 8000);
  };

  // dźwięk wymaga jednego kliknięcia w oknie
  const ov = document.createElement('div');
  ov.className = 'unlock';
  ov.innerHTML = '<div>Kliknij, żeby włączyć dźwięk<small>to okno jest opcjonalne: gracze widzą planszę u siebie</small><small>jeśli i tak je streamujesz, zezwól potem na udostępnienie tej karty, żeby nie zamarzało w tle</small></div>';
  ov.onclick = () => {
    stage.unlock();
    sound.play('bonus');
    ov.remove();
    keepAlive();
  };
  document.addEventListener('click', (e) => {
    if (!ov.isConnected && !keepStream && e.target !== ov && !ov.contains(e.target)) keepAlive();
  });
  document.body.appendChild(ov);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
      document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    }
  });
}

window.addEventListener('beforeunload', () => chan.close());
