// Telefon gracza: dołączenie do pokoju, buzzer, zakłady i odpowiedź w finale.
import { joinRoom, normalizeCode } from './net.js';

const EARLY_LOCK_MS = 1000;
const $app = document.getElementById('app');
const params = new URLSearchParams(location.search);

const ls = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let token = ls.get('pk.token');
if (!token) {
  token = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
  ls.set('pk.token', token);
}

let code = normalizeCode(params.get('r') || ls.get('pk.lastCode') || '');
let name = ls.get('pk.name') || '';
let link = null;
let net = 'connecting';
let view = null;
let viewAt = 0;
let lockUntil = 0;
let pressedAt = 0;
let sentWager = null;
let draft = '';

// ---------- ekran dołączania ----------

function renderJoin(error = '') {
  $app.innerHTML = `<form class="join" id="joinf" autocomplete="off">
    <h1>Totalna Kompromitacja</h1>
    <label><span class="label">Kod pokoju</span><input class="field code" id="code" value="${esc(code)}" maxlength="4" autocapitalize="characters" spellcheck="false" required></label>
    <label><span class="label">Twój nick</span><input class="field" id="name" value="${esc(name)}" maxlength="24" required></label>
    <button class="btn primary" type="submit">Wchodzę</button>
    <div class="err" role="alert">${esc(error)}</div>
  </form>`;
  const f = document.getElementById('joinf');
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    code = normalizeCode(document.getElementById('code').value);
    name = document.getElementById('name').value.trim().slice(0, 24);
    if (code.length !== 4) return renderJoin('Kod ma 4 litery.');
    if (!name) return renderJoin('Wpisz nick.');
    ls.set('pk.name', name);
    ls.set('pk.lastCode', code);
    params.set('r', code);
    history.replaceState(null, '', '?' + params.toString());
    start();
  });
  document.getElementById(code ? 'name' : 'code').focus();
}

function start() {
  link?.destroy();
  view = null;
  net = 'connecting';
  link = joinRoom(code, token, name, {
    onStatus(s) {
      net = s;
      if (s === 'kicked') {
        link?.destroy();
        link = null;
        return renderJoin('Prowadzący usunął Cię z gry.');
      }
      if (s === 'no-room' && !view) {
        link?.destroy();
        link = null;
        return renderJoin(`Nie ma pokoju ${code}. Sprawdź kod albo czy prowadzący ma otwarty panel.`);
      }
      render();
    },
    onMessage(m) {
      if (m.t === 'state') {
        const prev = view;
        view = m.view;
        viewAt = Date.now();
        if (prev?.phase !== view.phase) {
          sentWager = null;
          if (view.phase !== 'final-question') draft = '';
        }
        if (view.buzzed?.me && !(prev?.buzzed?.me)) navigator.vibrate?.([60, 40, 60]);
        render();
      }
    },
  });
  render();
}

// ---------- gra ----------

function buzz() {
  if (!view || view.phase !== 'question') return;
  const t = Date.now();
  if (t < lockUntil) return;
  if (view.canBuzz) {
    pressedAt = t;
    link?.send({ t: 'buzz' });
    navigator.vibrate?.(30);
    render();
  } else if (!view.buzzed && !view.tried && !view.dd) {
    lockUntil = t + EARLY_LOCK_MS;
    navigator.vibrate?.(200);
    render();
    setTimeout(render, EARLY_LOCK_MS + 20);
  }
}

function buzzerHTML() {
  const v = view;
  const t = Date.now();
  if (t < lockUntil) return `<button class="buzzer early" id="buzz">Za wcześnie<small>blokada na sekundę</small></button>`;
  if (v.buzzed?.me) return `<button class="buzzer mine" id="buzz">Odpowiadasz<small>mów głośno i wyraźnie</small></button>`;
  if (v.buzzed) return `<button class="buzzer locked" id="buzz">${esc(v.buzzed.name)}<small>zgłosił się pierwszy</small></button>`;
  if (v.tried) return `<button class="buzzer locked" id="buzz">Pudło<small>to pytanie już nie dla Ciebie</small></button>`;
  if (v.canBuzz) {
    const waiting = pressedAt && t - pressedAt < 1500;
    return `<button class="buzzer armed" id="buzz">${waiting ? 'Wysłane…' : 'Zgłaszam się'}<small>${waiting ? 'czekaj na decyzję' : 'wciśnij teraz'}</small></button>`;
  }
  return `<button class="buzzer" id="buzz">Czekaj<small>buzzery jeszcze zamknięte</small></button>`;
}

function body() {
  const v = view;
  const ph = v.phase;
  if (!v.me) return { info: ['Łączenie…', ''], center: '' };
  if (ph === 'lobby') return { info: ['Jesteś w grze', 'czekamy na start'], center: `<button class="buzzer" id="buzz" disabled>Rozgrzewka<small>tu będzie Twój buzzer</small></button>` };
  if (ph === 'opener') return { info: ['Zaraz zaczynamy', 'patrz na stream'], center: `<button class="buzzer" id="buzz" disabled>Czołówka<small>jeszcze możesz uciec</small></button>` };
  if (ph === 'rules') return { info: ['Zasady', 'słuchaj, potem nie płacz'], center: `<button class="buzzer" id="buzz" disabled>Zasady<small>buzzer ruszy w pierwszej rundzie</small></button>` };
  if (ph === 'round-intro') return { info: ['Nowa runda', `zaczyna ${v.pickerName}`], center: `<button class="buzzer" id="buzz">Czekaj<small>za chwilę plansza</small></button>` };
  if (ph === 'board')
    return {
      info: v.picker ? ['Ty wybierasz', 'podaj kategorię i stawkę na głos'] : [`Wybiera ${v.pickerName}`, 'patrz na stream'],
      center: `<button class="buzzer" id="buzz">Czekaj<small>buzzery jeszcze zamknięte</small></button>`,
    };
  if (ph === 'dd') {
    if (v.picker && v.ddMax) {
      return {
        info: ['Wszystko albo nic', `${v.category} · grasz tylko Ty`],
        center: `<form class="form" id="wagerf"><span class="label">Twoja stawka (5–${v.ddMax})</span>
          <input class="field" id="wager" inputmode="numeric" pattern="[0-9]*" placeholder="np. ${Math.min(500, v.ddMax)}" ${sentWager != null ? 'disabled' : ''}>
          <button class="btn primary" ${sentWager != null ? 'disabled' : ''}>${sentWager != null ? `Wysłano ${sentWager}` : 'Stawiam'}</button>
          <div class="hint">Możesz też powiedzieć stawkę na głos, prowadzący ją wpisze.</div></form>`,
      };
    }
    return { info: ['Wszystko albo nic', `${v.pickerName} gra sam`], center: `<button class="buzzer locked" id="buzz">Patrz<small>to nie Twoja tura</small></button>` };
  }
  if (ph === 'question') {
    if (v.dd) {
      return v.buzzed?.me
        ? { info: [`${v.category} · ${v.value}`, 'wszystko albo nic'], center: `<button class="buzzer mine" id="buzz">Odpowiadasz<small>stawka ${v.value}</small></button>` }
        : { info: [`${v.category} · ${v.value}`, `${v.pickerName} gra o wszystko`], center: `<button class="buzzer locked" id="buzz">Patrz<small>to nie Twoja tura</small></button>` };
    }
    return { info: [`${v.category} · ${v.value}`, 'pytanie na streamie'], center: buzzerHTML() };
  }
  if (ph === 'reveal') {
    const r = v.result;
    let html;
    if (r?.mine && r.verdict !== 'wrong') html = `<div class="r">Dobrze</div><div class="d">+${r.delta}</div>`;
    else if (r?.mine) html = `<div class="r red">Pudło</div><div class="d">${r.delta}</div>`;
    else if (v.tried) html = `<div class="r red">Pudło</div><div class="d">było blisko? nie było</div>`;
    else if (!r || r.verdict === 'nobody') html = `<div class="r">Nikt</div><div class="d">nie wiedział</div>`;
    else html = `<div class="r">${esc(r.verdict === 'wrong' ? 'Ktoś pudłuje' : 'Ktoś trafia')}</div><div class="d"></div>`;
    return { info: [`${v.category} · ${v.value}`, 'odpowiedź na streamie'], center: `<div class="result">${html}</div>` };
  }
  if (ph.startsWith('final') && v.final) {
    const f = v.final;
    if (!f.inFinal) return { info: ['Finał', f.category], center: `<div class="result"><div class="r red">Bez finału</div><div class="d">wynik na minusie albo zero. patrz i cierp</div></div>` };
    if (ph === 'final-intro') return { info: ['Finał', f.category], center: `<div class="result"><div class="r">Finał</div><div class="d">zaraz obstawiasz</div></div>` };
    if (ph === 'final-wager') {
      const done = f.wager != null;
      return {
        info: ['Finał · zakład', f.category],
        center: `<form class="form" id="fwagerf"><span class="label">Zakład (0–${v.me.score})</span>
          <input class="field" id="fwager" inputmode="numeric" pattern="[0-9]*" placeholder="0–${v.me.score}">
          <button class="btn primary">${done ? `Przyjęty: ${f.wager}. Zmień` : 'Obstawiam'}</button>
          <div class="hint">Dobra odpowiedź dodaje zakład, zła go zabiera. Możesz zmienić, dopóki prowadzący nie pokaże pytania.</div></form>`,
      };
    }
    if (ph === 'final-question') {
      const left = f.remaining != null ? Math.max(0, f.remaining - (Date.now() - viewAt)) : null;
      const over = left === 0;
      return {
        info: ['Finał · odpowiedź', `zakład ${f.wager ?? 0}`],
        center: `<form class="form" id="fansf"><div class="countdown${left != null && left < 5000 ? ' low' : ''}" id="cd">${left != null ? Math.ceil(left / 1000) : ''}</div>
          <textarea class="field" id="fans" maxlength="140" placeholder="Twoja odpowiedź" ${over ? 'disabled' : ''}></textarea>
          <button class="btn primary" ${over ? 'disabled' : ''}>${f.answer != null ? 'Wyślij poprawkę' : 'Wyślij'}</button>
          <div class="hint">${f.answer != null ? `Wysłano: <b>${esc(f.answer)}</b>` : 'Liczy się ostatnia wysłana wersja.'}</div></form>`,
      };
    }
    if (ph === 'final-reveal') return { info: ['Finał', 'odsłaniamy na streamie'], center: `<div class="result"><div class="r">Odsłaniamy</div><div class="d">${f.answer != null ? esc(f.answer) : '(nic nie wysłano)'}</div></div>` };
  }
  if (ph === 'end') {
    return {
      info: ['Koniec odcinka', 'dzięki za grę'],
      center: `<div class="rank">${(v.ranking || []).map((p, i) => `<div class="${p.me ? 'me' : ''}"><span>${i + 1}. ${esc(p.name)}</span><b>${p.score}</b></div>`).join('')}</div>`,
    };
  }
  return { info: ['…', ''], center: '' };
}

function render() {
  if (!link) return;
  const nets = { connecting: 'łączenie…', open: 'połączono', lost: 'zerwane, łączę…', error: 'błąd, ponawiam…', 'no-room': 'brak pokoju, ponawiam…' };
  const netTxt = nets[net] || net;
  if (!view) {
    $app.innerHTML = `<div class="app"><div class="strip"><div class="logo">Totalna Kompromitacja</div><div class="me"><span class="nm">${esc(name)}</span></div></div>
      <div class="info"><div class="big">Pokój ${esc(code)}</div><div class="small">${esc(netTxt)}</div></div>
      <div class="center"><button class="buzzer" disabled>Łączenie<small>chwila</small></button></div>
      <div class="foot"><span>kod ${esc(code)}</span><button class="btn small ghost" id="leave">Zmień pokój / nick</button></div></div>`;
    document.getElementById('leave').onclick = leave;
    return;
  }
  // nie przerywaj pisania w polu tekstowym
  const a = document.activeElement;
  const typing = a && (a.id === 'fans' || a.id === 'wager' || a.id === 'fwager') ? { id: a.id, v: a.value } : null;
  if (a?.id === 'fans') draft = a.value;
  const b = body();
  const me = view.me;
  $app.innerHTML = `<div class="app">
    <div class="strip"><div class="logo">TK</div><div class="me"><span class="nm">${esc(me?.name || name)}</span><span class="sc${me && me.score < 0 ? ' neg' : ''}">${me ? me.score : ''}</span></div></div>
    <div class="info"><div class="big">${esc(b.info[0])}</div><div class="small">${esc(b.info[1])}</div></div>
    <div class="center">${b.center}</div>
    <div class="foot"><span class="net${net === 'open' ? '' : ' bad'}">${esc(netTxt)}</span><span>spacja też działa</span></div>
  </div>`;
  const fans = document.getElementById('fans');
  if (fans && draft) fans.value = draft;
  if (typing) {
    const el = document.getElementById(typing.id);
    if (el && !el.disabled) {
      el.value = typing.v;
      el.focus();
    }
  }
  bind();
}

function bind() {
  const btn = document.getElementById('buzz');
  if (btn) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      buzz();
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') buzz();
    });
  }
  const wf = document.getElementById('wagerf');
  if (wf)
    wf.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = Math.round(Number(document.getElementById('wager').value));
      if (!Number.isFinite(v) || v < 5 || v > view.ddMax) return flash('wager');
      sentWager = v;
      link.send({ t: 'wager', amount: v });
      render();
    });
  const fw = document.getElementById('fwagerf');
  if (fw)
    fw.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = Math.round(Number(document.getElementById('fwager').value));
      if (!Number.isFinite(v) || v < 0 || v > view.me.score) return flash('fwager');
      link.send({ t: 'wager', amount: v });
      document.getElementById('fwager').value = '';
      document.activeElement?.blur();
    });
  const fa = document.getElementById('fansf');
  if (fa)
    fa.addEventListener('submit', (e) => {
      e.preventDefault();
      const el = document.getElementById('fans');
      draft = el.value;
      link.send({ t: 'answer', text: el.value.trim() });
      el.blur();
    });
}

function flash(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = 'var(--tally)';
  el.focus();
  setTimeout(() => (el.style.borderColor = ''), 900);
}

function leave() {
  link?.destroy();
  link = null;
  view = null;
  renderJoin();
}

document.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || e.repeat) return;
  const t = e.target;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
  e.preventDefault();
  buzz();
});

// odliczanie w finale i powrót z „Wysłane…”
setInterval(() => {
  if (!view) return;
  if (view.phase === 'final-question') {
    const cd = document.getElementById('cd');
    const f = view.final;
    if (cd && f?.remaining != null) {
      const left = Math.max(0, f.remaining - (Date.now() - viewAt));
      cd.textContent = Math.ceil(left / 1000);
      cd.classList.toggle('low', left < 5000);
    }
  }
  if (pressedAt && Date.now() - pressedAt > 1500 && Date.now() - pressedAt < 2000 && view.canBuzz) render();
}, 250);

if (code && name && params.get('r')) start();
else renderJoin();
