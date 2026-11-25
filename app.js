/* Instinct — study party game. Host-authoritative multiplayer over PeerJS (WebRTC). */
(() => {
'use strict';

const DATA = window.INSTINCT_DATA || { subjects: [] };
const SUBJ = Object.fromEntries(DATA.subjects.map(s => [s.subject, s]));
const TIERS = [null,
  { name: 'Obvious', pts: 100 }, { name: 'Solid', pts: 200 }, { name: 'Sharp', pts: 350 },
  { name: 'Rare', pts: 550 }, { name: 'Instinct', pts: 800 }];
const LONE_WOLF = 150;
const MAX_HINTS = 3;
const COLORS = ['#3B4CCA', '#E0533D', '#0F8B6E', '#8E44AD', '#C27C0E', '#1F7AB8', '#B83271', '#4E7D2B', '#6B5B95', '#D35400'];
const BOT_NAMES = ['Darwin', 'Keynes', 'Curie', 'Gauss', 'Frida', 'Hamid', 'Plato', 'Lovelace'];
const PEER_PREFIX = 'instinct-ibdp-';

/* ---------------- helpers ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rand = n => Math.floor(Math.random() * n);
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const store = {
  get(k, d) { try { const v = localStorage.getItem('instinct:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('instinct:' + k, JSON.stringify(v)); } catch {} }
};
function tabId() {
  try { let id = sessionStorage.getItem('instinct:pid'); if (!id) { id = 'p' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('instinct:pid', id); } return id; }
  catch { return 'p' + Math.random().toString(36).slice(2, 10); }
}
const PID = tabId();
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }
const bars = (tier, cls = '') => `<span class="bars t${tier} ${cls}" aria-hidden="true">${[1, 2, 3, 4, 5].map(i => `<b class="${i <= tier ? 'on' : ''}"></b>`).join('')}</span>`;
const initials = n => ((n || '?').replace(/\(bot\)/i, '').trim().split(/\s+/).filter(w => /^\p{L}/u.test(w)).map(w => w[0]).join('') || '?').slice(0, 2).toUpperCase();
const safeColor = c => /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#888888';
const av = (p, s = '') => `<span class="av ${s}" style="background:${safeColor(p.color)}" title="${esc(p.name)}">${esc(initials(p.name))}</span>`;
const subjName = code => SUBJ[code]?.name || code;
const unitName = (code, uid) => SUBJ[code]?.units.find(u => u.id === uid)?.name || '';
const fmt = n => Math.round(n).toLocaleString('en-US');

/* ---------------- answer matching ---------------- */
const ARTICLES = /^(the|a|an|el|la|los|las|un|una|unos|unas|le|les)\s+/;
function norm(s) {
  s = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[−–—]/g, '-').replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/&/g, ' and ').replace(/[’'`´"]/g, '')
    .replace(/[^a-z0-9.\-+%/^ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(ARTICLES, '');
  if (/^[-+]?\d+(\.\d+)?$/.test(s)) return String(parseFloat(s));
  s = s.replace(/(^|\s)[.\-]+|[.\-]+(\s|$)/g, ' ').trim();
  return s.split(' ').map(w => (w.length > 3 && /s$/.test(w) && !/ss$/.test(w) && !/\d/.test(w)) ? w.slice(0, -1) : w).join(' ');
}
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
const keyCache = new Map();
function keysFor(p) {
  if (keyCache.has(p)) return keyCache.get(p);
  const keys = [];
  p.answers.forEach((a, i) => [a.text, ...(a.alias || [])].forEach(t => { const k = norm(t); if (k) keys.push({ i, k, nk: k.replace(/ /g, ''), num: /^[-+]?\d/.test(k) && !/[a-z]/.test(k) }); }));
  keyCache.set(p, keys); return keys;
}
let ALLKEYS = null;   // every accepted answer in the whole bank: a real answer elsewhere is never a "typo"
function allKeys() {
  if (ALLKEYS) return ALLKEYS;
  ALLKEYS = new Set();
  for (const s of DATA.subjects) for (const p of s.prompts) for (const k of keysFor(p)) { ALLKEYS.add(k.k); ALLKEYS.add(k.nk); }
  return ALLKEYS;
}
const digits = s => s.replace(/\D/g, '');
const unique = arr => { const u = [...new Set(arr)]; return u.length === 1 ? u[0] : -1; };
function matchAnswer(p, raw) {
  const n = norm(raw); if (!n) return -1;
  const nn = n.replace(/ /g, ''); const keys = keysFor(p);
  const hasDigit = /\d/.test(n);
  for (const k of keys) if (k.k === n || (!hasDigit && !/\d/.test(k.k) && k.nk === nn)) return k.i;
  if (hasDigit && !/[a-z]/.test(n)) return -1;           // numbers must match exactly
  if (allKeys().has(n) || allKeys().has(nn)) return -1;  // e.g. "70S ribosomes" is its own answer, not a typo of "80S"
  // 1) small typos: 1 edit for 6+ letters, 2 edits for 13+; digits must be identical
  let best = [], bd = 99;
  for (const k of keys) {
    if (k.num) continue;
    const max = k.nk.length >= 13 ? 2 : k.nk.length >= 6 ? 1 : 0;
    if (!max || nn.length < 5 || digits(nn) !== digits(k.nk)) continue;
    const d = lev(nn, k.nk, max);
    if (d <= max) { if (d < bd) { bd = d; best = [k.i]; } else if (d === bd) best.push(k.i); }
  }
  if (best.length) return unique(best);
  // 2) answer wrapped in extra words: "the proportion of income spent" → "proportion of income"
  const padded = ' ' + n + ' ';
  const wrapped = keys.filter(k => !k.num && k.k.length >= 6 && padded.includes(' ' + k.k + ' ') && k.k.length / n.length >= .5).map(k => k.i);
  if (wrapped.length) return unique(wrapped);
  // 3) the start of a longer answer: "durable" → "durable goods"
  if (n.length >= 5) {
    const starts = keys.filter(k => !k.num && k.k.startsWith(n + ' ') && n.length / k.k.length >= .55).map(k => k.i);
    if (starts.length) return unique(starts);
  }
  return -1;
}

/* ---------------- prompt pool ---------------- */
function allPrompts(codes) {
  const out = [];
  for (const c of codes) for (const p of (SUBJ[c]?.prompts || [])) out.push({ key: c + ':' + p.id, subject: c, p });
  return out;
}
function promptByKey(key) {
  if (!key) return null;
  const [c, id] = key.split(':');
  const p = SUBJ[c]?.prompts.find(x => x.id === id);
  return p ? { key, subject: c, p } : null;
}

/* ---------------- game engine (runs on the host only) ---------------- */
function newRoom(opts) {
  return {
    code: opts.code, hostPid: PID, offline: !!opts.offline,
    phase: 'lobby',
    settings: { subjects: opts.subjects || DATA.subjects.map(s => s.subject), units: 'all', rounds: 5, time: 45, hints: true, bots: opts.bots ?? 0 },
    players: {}, order: [],
    round: 0, promptKey: null, used: [], history: [],
    endsAt: 0, found: {}, done: {}, results: null
  };
}
let room = null;        // authoritative state (host only)
let view = null;        // last state the UI knows about (host + clients)
let isHost = false;
let peer = null, hostConn = null; const conns = new Map();
let tickTimer = null, botTimers = [];
let viewDeadline = 0;   // Date.now() based deadline (performance.now() pauses while a phone sleeps)

function addPlayer(pid, name, bot = false) {
  if (!room.players[pid]) {
    room.players[pid] = { pid, name: name.slice(0, 18) || 'Player', color: COLORS[room.order.length % COLORS.length], score: 0, bot, connected: true };
    room.order.push(pid);
  } else { room.players[pid].connected = true; if (name) room.players[pid].name = name.slice(0, 18); }
}
function syncBots() {
  const bots = room.order.filter(id => room.players[id].bot);
  const want = room.settings.bots;
  for (let i = bots.length; i < want; i++) addPlayer('bot' + i, BOT_NAMES[i % BOT_NAMES.length] + ' (bot)', true);
  for (let i = want; i < bots.length; i++) { const id = bots[i]; delete room.players[id]; room.order = room.order.filter(x => x !== id); }
}
function pickPrompt() {
  let pool = allPrompts(room.settings.subjects);
  if (room.settings.units === 'current') pool = pool.filter(x => currentUnits(x.subject).includes(x.p.unit));
  if (!pool.length) pool = allPrompts(room.settings.subjects);
  let fresh = pool.filter(x => !room.used.includes(x.key));
  if (!fresh.length) { room.used = []; fresh = pool; }
  // rotate subjects so a 5-round game doesn't land on one subject
  const lastSubj = room.history.slice(-2).map(k => k.split(':')[0]);
  const varied = fresh.filter(x => !lastSubj.includes(x.subject));
  const pick = (varied.length ? varied : fresh)[rand((varied.length ? varied : fresh).length)];
  room.used.push(pick.key); return pick.key;
}
function currentUnits(code) { const s = SUBJ[code]; if (!s) return []; return s.current?.length ? s.current : s.units.slice(-1).map(u => u.id); }

function startGame() {
  syncBots();
  room.order.forEach(id => room.players[id].score = 0);
  room.round = 0; room.history = []; nextRound();
}
function nextRound() {
  clearBots();
  room.round++;
  room.promptKey = pickPrompt(); room.history.push(room.promptKey);
  room.phase = 'round'; room.found = {}; room.done = {}; room.results = null;
  room.endsAt = Date.now() + room.settings.time * 1000;
  runBots();
  clearInterval(tickTimer); tickTimer = setInterval(tick, 250);
  broadcast();
}
function tick() {
  if (room.phase !== 'round') return;
  const humans = room.order.filter(id => !room.players[id].bot && room.players[id].connected);
  const allDone = humans.length > 0 && humans.every(id => room.done[id]);
  if (Date.now() >= room.endsAt || allDone) endRound();
}
function endRound() {
  clearInterval(tickTimer); clearBots();
  // if everyone finished early, bots still get the answers they were going to type
  for (const [id, i] of botPlan) if (room.players[id]) (room.found[id] ||= {})[i] ||= { hint: false };
  botPlan = [];
  const { p } = promptByKey(room.promptKey);
  const per = p.answers.map((a, i) => ({ i, by: [], pts: 0 }));
  for (const [pid, f] of Object.entries(room.found)) for (const [i, info] of Object.entries(f)) if (per[i]) per[i].by.push({ pid, hint: !!info.hint });
  const roundPts = {}; room.order.forEach(id => roundPts[id] = 0);
  per.forEach(r => {
    if (!r.by.length) return;
    const base = TIERS[p.answers[r.i].tier].pts;
    r.pts = Math.round(base / r.by.length);
    r.by.forEach(b => { roundPts[b.pid] = (roundPts[b.pid] || 0) + (b.hint ? Math.round(r.pts / 2) : r.pts); });
  });
  let wolfTier = 0, wolves = [];
  per.forEach(r => {
    const t = p.answers[r.i].tier;
    if (r.by.length === 1 && !r.by[0].hint && t >= 3) {
      if (t > wolfTier) { wolfTier = t; wolves = [{ pid: r.by[0].pid, i: r.i }]; }
      else if (t === wolfTier && !wolves.some(w => w.pid === r.by[0].pid)) wolves.push({ pid: r.by[0].pid, i: r.i });
    }
  });
  wolves.forEach(w => roundPts[w.pid] += LONE_WOLF);
  Object.entries(roundPts).forEach(([pid, n]) => { if (room.players[pid]) room.players[pid].score += n; });
  room.results = { per, roundPts, wolves };
  room.phase = 'reveal';
  broadcast();
}
function finishGame() { room.phase = 'final'; broadcast(); }
function backToLobby() { clearInterval(tickTimer); clearBots(); room.phase = 'lobby'; room.round = 0; room.results = null; room.promptKey = null; broadcast(); }

let botPlan = [];
function clearBots() { botTimers.forEach(clearTimeout); botTimers = []; }
function runBots() {
  botPlan = [];
  const { p } = promptByKey(room.promptKey);
  const ms = room.settings.time * 1000;
  const chance = [0, .7, .45, .25, .12, .05];
  room.order.filter(id => room.players[id].bot).forEach((id, k) => {
    const skill = .6 + k * .15;
    room.done[id] = true;
    p.answers.forEach((a, i) => {
      if (Math.random() < chance[a.tier] * skill) {
        botPlan.push([id, i]);
        botTimers.push(setTimeout(() => {
          if (room.phase !== 'round') return;
          (room.found[id] ||= {})[i] = { hint: false };
          broadcast();
        }, ms * (.08 + Math.random() * .8)));
      }
    });
  });
}

/* host-side message handling (also used for the host's own actions) */
function handle(pid, msg, conn) {
  if (!room) return;
  switch (msg.t) {
    case 'hello':
      addPlayer(pid, msg.name || 'Player');
      if (conn) conns.set(pid, conn);
      broadcast(); break;
    case 'found':
      if (room.phase !== 'round' || msg.round !== room.round) return;
      { const n = promptByKey(room.promptKey).p.answers.length; const f = (room.found[pid] ||= {});
        for (const item of msg.list.slice(0, 40)) { if (!Array.isArray(item)) continue; const [i, hint] = item; if (Number.isInteger(i) && i >= 0 && i < n && !f[i]) f[i] = { hint: !!hint }; } }
      broadcast(); break;
    case 'done':
      if (room.phase !== 'round' || msg.round !== room.round) return;
      room.done[pid] = !!msg.done; broadcast(); tick(); break;
    case 'bye':
      if (room.players[pid]) room.players[pid].connected = false; conns.delete(pid); broadcast(); break;
  }
}
function publicState() {
  const s = JSON.parse(JSON.stringify(room));
  s.remaining = Math.max(0, room.endsAt - Date.now());
  delete s.endsAt; delete s.used;
  if (room.phase === 'round') {
    s.counts = Object.fromEntries(Object.entries(room.found).map(([pid, f]) => [pid, Object.keys(f).length]));
    s.found = {};  // keep everyone's answers secret until the reveal
  }
  return s;
}
let bcT = null;
function broadcast() {
  if (bcT) return;
  bcT = setTimeout(() => {
    bcT = null;
    const s = publicState();
    for (const [pid, c] of conns) { if (c.open) { try { c.send({ t: 'state', s }); } catch {} } }
    receiveState(s);
  }, 60);
}
function hostAct(msg) { if (isHost) handle(PID, msg); else if (hostConn?.open) hostConn.send(msg); }

/* ---------------- networking ---------------- */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const makeCode = () => Array.from({ length: 4 }, () => CODE_CHARS[rand(CODE_CHARS.length)]).join('');

const PID_RE = /^p[a-z0-9]{6,12}$/;
const SECRET = (() => { try { let k = sessionStorage.getItem('instinct:key'); if (!k) { k = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); sessionStorage.setItem('instinct:key', k); } return k; } catch { return Math.random().toString(36).slice(2); } })();
const secrets = new Map();   // pid → secret, host only, never broadcast
let failT = null, joinedCode = null, wakeLock = null;
async function keepAwake() { try { if (isHost && !view?.offline && 'wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch {} }

function onHostData(conn, msg) {
  try {
    if (!msg || typeof msg !== 'object' || !PID_RE.test(msg.pid || '')) return;
    const pid = msg.pid;
    if (msg.t === 'hello') {
      const known = secrets.get(pid);
      if (known && known !== msg.secret) return;          // someone else using this pid
      secrets.set(pid, String(msg.secret || ''));
      const old = conns.get(pid); if (old && old !== conn) { try { old.close(); } catch {} }
      conns.set(pid, conn);
      msg = { t: 'hello', name: String(msg.name || '').slice(0, 18) };
      handle(pid, msg, conn);
      // give a returning player back their answers for the current round
      if (room.phase === 'round') conn.send({ t: 'resume', round: room.round, found: room.found[pid] || {}, done: !!room.done[pid] });
      return;
    }
    if (conns.get(pid) !== conn) return;                   // messages only from the connection that said hello
    if (msg.t === 'found' && !Array.isArray(msg.list)) return;
    handle(pid, msg, conn);
  } catch {}
}
function hostRoom({ offline = false, bots = 0 } = {}) {
  teardown();
  isHost = true; screen = 'room';
  const name = store.get('name', '') || 'Host';
  room = newRoom({ code: offline ? 'SOLO' : makeCode(), offline, bots, subjects: store.get('subjects', null) || undefined });
  const saved = store.get('settings', null); if (saved) Object.assign(room.settings, saved, { bots });
  room.settings.subjects = room.settings.subjects.filter(c => SUBJ[c]); if (!room.settings.subjects.length) room.settings.subjects = DATA.subjects.map(s => s.subject);
  addPlayer(PID, name);
  syncBots();
  if (offline) { broadcast(); return; }
  renderConnecting('Opening your room…');
  const open = (tries) => {
    peer = new Peer(PEER_PREFIX + room.code.toLowerCase(), { debug: 0 });
    peer.on('open', () => { history.replaceState(null, '', '#' + room.code); broadcast(); keepAwake(); });
    peer.on('connection', conn => {
      conn.on('data', msg => onHostData(conn, msg));
      conn.on('close', () => { for (const [pid, c] of conns) if (c === conn) handle(pid, { t: 'bye' }); });
    });
    peer.on('error', err => {
      if (err.type === 'unavailable-id') {
        if (tries < 4) { peer.destroy(); room.code = makeCode(); open(tries + 1); return; }
        renderError('Couldn’t find a free room code. Try again in a moment.'); return;
      }
      if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible', 'ssl-unavailable'].includes(err.type)) renderError('Couldn’t reach the matchmaking server. Check your internet and try again. Solo practice still works offline.');
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
  };
  open(0);
}
function joinRoom(code) {
  teardown();
  isHost = false; screen = 'room';
  code = code.toUpperCase(); joinedCode = code;
  renderConnecting(`Joining room ${code}…`);
  peer = new Peer({ debug: 0 });
  let opened = false;
  failT = setTimeout(() => { if (!opened) renderError(`Couldn’t reach room ${code}. Check the code, and make sure the host still has the game open.`, code); }, 15000);
  peer.on('open', () => {
    hostConn = peer.connect(PEER_PREFIX + code.toLowerCase(), { reliable: true });
    hostConn.on('open', () => { opened = true; clearTimeout(failT); history.replaceState(null, '', '#' + code); sayHello(); });
    hostConn.on('data', msg => {
      if (msg?.t === 'state' && msg.s && typeof msg.s === 'object') receiveState(msg.s);
      if (msg?.t === 'resume') resume(msg);
    });
    hostConn.on('close', () => { if (view && view.phase !== 'final' && document.visibilityState === 'visible') renderError('Lost connection to the host. If they still have the game open, rejoin with the same code.', code); });
  });
  peer.on('error', err => {
    clearTimeout(failT);
    if (err.type === 'peer-unavailable') renderError(`There’s no room called ${code} right now. Check the code with your friend; the host has to keep the game open.`, code);
    else renderError('Connection problem: ' + (err.type || 'unknown') + '. Try again in a moment.', code);
  });
}
function sayHello() { if (hostConn?.open) hostConn.send({ t: 'hello', pid: PID, secret: SECRET, name: store.get('name', '') || 'Player' }); }
let pendingResume = null;
function resume(msg) { pendingResume = msg; applyResume(); }
function applyResume() {
  const msg = pendingResume;
  if (!msg || !view || view.phase !== 'round' || msg.round !== view.round) return;
  pendingResume = null;
  const pk = promptByKey(view.promptKey); if (!pk) return;
  local.round = msg.round;
  for (const [i, v] of Object.entries(msg.found || {})) {
    const idx = +i; if (!pk.p.answers[idx] || local.found.has(idx)) continue;
    local.found.set(idx, { hint: !!v.hint, typed: pk.p.answers[idx].text }); if (v.hint) local.hinted.add(idx);
  }
  local.done = !!msg.done;
  if (view.phase === 'round' && screen === 'room') renderRound();
}
function teardown() {
  clearInterval(tickTimer); clearBots(); clearInterval(uiTimer); clearTimeout(failT); clearTimeout(bcT); bcT = null;
  try { hostConn?.close(); } catch {}
  try { peer?.destroy(); } catch {}
  try { wakeLock?.release(); } catch {}
  peer = null; hostConn = null; pendingResume = null; conns.clear(); secrets.clear(); room = null; view = null; isHost = false; joinedCode = null; wakeLock = null; local = freshLocal();
}
window.addEventListener('pagehide', () => { try { if (hostConn?.open) hostConn.send({ t: 'bye', pid: PID }); } catch {} });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (isHost) { keepAwake(); if (room) broadcast(); return; }
  if (!joinedCode || screen !== 'room') { if (joinedCode && $('[data-act=rejoin]')) joinRoom(joinedCode); return; }
  if (hostConn?.open) sayHello(); else joinRoom(joinedCode);   // phone woke up: refresh or reconnect
});

/* ---------------- client-side state ---------------- */
function freshLocal() { return { round: -1, found: new Map(), wrong: [], hinted: new Set(), hintIdx: null, done: false }; }
let local = freshLocal();
let uiTimer = null;
let screen = 'home';

function receiveState(s) {
  const prev = view; view = s;
  if (s.phase === 'round') viewDeadline = Date.now() + Number(s.remaining || 0);
  if (s.phase === 'round' && local.round !== s.round) { local = freshLocal(); local.round = s.round; }
  if (pendingResume) setTimeout(applyResume, 0);
  const samePhase = prev && prev.phase === s.phase && prev.round === s.round;
  if (screen !== 'room') {
    // reading the answer bank after a game: only come back when a new round starts
    if (!(s.phase === 'round' && !samePhase)) return;
  }
  screen = 'room';
  if (samePhase && s.phase !== 'final') patchRoom(); else if (!samePhase) renderRoom();
}
function sendFound() { hostAct({ t: 'found', pid: PID, round: view.round, list: [...local.found.entries()].map(([i, v]) => [i, v.hint]) }); }

/* ---------------- rendering: shell ---------------- */
function topbar(extra = '') {
  return `<div class="bar"><button class="wordmark" data-act="home" aria-label="Instinct home"><span class="bars"><b></b><b></b><b></b><b></b><b></b></span>instinct</button><span class="sp"></span>${extra}</div>`;
}
function renderConnecting(msg) {
  app.innerHTML = `<div class="view">${topbar()}<div class="card narrow center"><h2>${esc(msg)}</h2><p class="muted">This takes a second or two.</p></div></div>`;
}
function renderError(msg, retryCode) {
  clearInterval(uiTimer);
  app.innerHTML = `<div class="view">${topbar()}<div class="card narrow"><h2>That didn’t connect</h2><p class="muted">${esc(msg)}</p>
  <div class="row mt">${retryCode ? `<button class="btn ink" data-act="rejoin" data-code="${esc(retryCode)}">Rejoin ${esc(retryCode)}</button>` : ''}<button class="btn" data-act="home">Back to start</button></div></div></div>`;
}

/* ---------------- home ---------------- */
function renderHome() {
  teardown(); screen = 'home';
  const hash = (location.hash || '').replace('#', '').toUpperCase();
  const code = /^[A-Z]{4}$/.test(hash) && hash !== 'SOLO' ? hash : '';
  const name = store.get('name', '');
  const nP = DATA.subjects.reduce((a, s) => a + s.prompts.length, 0);
  const nC = DATA.subjects.reduce((a, s) => a + s.cards.length, 0);
  app.innerHTML = `<div class="view">${topbar()}
  <div class="home">
    <section class="hero">
      <div class="eyebrow">Study party game · IB Year 1</div>
      <h1>Trust your<br>instinct.</h1>
      <p>Everyone gets the same prompt. Type every answer you know before time runs out. Obvious answers score a little; the ones nobody else remembers score a lot.</p>
      <div class="howto">
        <div>${bars(1)}<span><b>Name a determinant of PED.</b> “Substitutes” is Obvious, 100 points. “Proportion of income” is Sharp, 350.</span></div>
        <div>${bars(3)}<span><b>Same answer as a friend?</b> You share a brain, so you split the points.</span></div>
        <div>${bars(5)}<span><b>After every round</b> you see every answer with a one-line explanation. That’s the studying part.</span></div>
      </div>
      <div class="tiers">${TIERS.slice(1).map((t, i) => `<span class="tierpill">${bars(i + 1)}${t.name}<span class="pts">${t.pts}</span></span>`).join('')}</div>
    </section>
    <section>
      <div class="card">
        <label class="field"><span>Your name</span><input class="input" id="name" maxlength="18" autocomplete="nickname" placeholder="What friends call you" value="${esc(name)}"></label>
        <label class="field"><span>Room code from a friend</span>
          <div class="row"><input class="input code grow" id="code" maxlength="4" autocomplete="off" placeholder="ABCD" value="${esc(code)}" inputmode="latin" aria-label="Room code"><button class="btn ink" data-act="join">Join</button></div>
        </label>
        <div class="or">or</div>
        <button class="btn primary block" data-act="host">Start a room for friends</button>
      </div>
      <div class="card">
        <div class="eyebrow" style="margin-bottom:12px">Study on your own</div>
        <div class="solo">
          <button class="tile" data-act="bots"><b>Play vs bots</b><span>Same game, three bots</span></button>
          <button class="tile" data-act="flash"><b>Flashcards</b><span>${nC} cards, flip and sort</span></button>
          <button class="tile" data-act="quiz"><b>Quiz</b><span>10 questions, with hints</span></button>
          <button class="tile" data-act="learn"><b>Answer bank</b><span>All ${nP} prompts, explained</span></button>
        </div>
      </div>
    </section>
  </div></div>`;
  const ci = $('#code');
  ci.addEventListener('input', () => { ci.value = ci.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  ci.addEventListener('keydown', e => { if (e.key === 'Enter') act('join'); });
  if (code) $('#name').focus();
}
function saveName() { const el = $('#name'); if (el) store.set('name', el.value.trim().slice(0, 18)); return store.get('name', ''); }

/* ---------------- room: lobby / round / reveal / final ---------------- */
function me() { return view?.players?.[PID]; }
function renderRoom() {
  clearInterval(uiTimer);
  if (!view) return;
  ({ lobby: renderLobby, round: renderRound, reveal: renderReveal, final: renderFinal })[view.phase]();
}
function patchRoom() {
  if (view.phase === 'lobby') { renderLobby(true); return; }
  if (view.phase === 'round') { const side = $('#side'); if (side) side.innerHTML = sideScores(true); }
  if (view.phase === 'reveal') { const side = $('#side'); if (side) side.innerHTML = revealScores(); }
}
function inviteLink() { return location.origin + location.pathname + '#' + view.code; }

function renderLobby(patch = false) {
  const s = view.settings; const host = isHost;
  const focusId = document.activeElement?.id;
  const subjChips = DATA.subjects.map(x => `<button class="chip" data-act="subj" data-code="${x.subject}" aria-pressed="${s.subjects.includes(x.subject)}" ${host ? '' : 'disabled'}>${esc(x.name)}<span class="n">${x.prompts.length}</span></button>`).join('');
  const seg = (key, opts, fmtf = v => v) => `<div class="seg" role="group">${opts.map(v => `<button data-act="set" data-key="${key}" data-val="${v}" aria-pressed="${String(s[key]) === String(v)}" ${host ? '' : 'disabled'}>${fmtf(v)}</button>`).join('')}</div>`;
  const y = window.scrollY;
  app.innerHTML = `<div class="${patch ? '' : 'view'}">${topbar(`<button class="btn ghost sm" data-act="leave">Leave</button>`)}
  <div class="lobby">
    <div class="card">
      ${view.offline ? `<div class="eyebrow">Solo practice</div><h2 class="mt">You vs the bots</h2><p class="muted">Pick subjects, then start. Bots answer from the same list, and they’re beatable.</p>` :
      `<div class="eyebrow">Room code</div><div class="roomcode">${esc(view.code)}</div>
      <p class="muted small">Friends open the link, or go to this site and type the code.${host ? ' You’re hosting: keep this tab open and your screen on.' : ''}</p>
      <div class="row"><button class="btn ink" data-act="copy">Copy invite link</button>${navigator.share ? '<button class="btn" data-act="share">Share</button>' : ''}</div>`}
      <h3 class="mt2">Players <span class="muted mono small">${view.order.length}</span></h3>
      <ul class="players">${view.order.map(id => { const p = view.players[id]; return `<li class="${p.connected ? '' : 'off'}">${av(p)}<span class="sp">${esc(p.name)}${id === PID ? ' <span class="muted small">(you)</span>' : ''}</span>${id === view.hostPid ? '<span class="tag">host</span>' : ''}${p.bot ? '<span class="tag">bot</span>' : ''}</li>`; }).join('')}</ul>
    </div>
    <div class="card">
      <h2>Game settings</h2>
      ${host ? '' : '<p class="muted small">The host picks these. You’ll start when they press Start.</p>'}
      <div class="subjects"><div class="row" style="justify-content:space-between;align-items:center;margin-bottom:10px"><b>Subjects</b>${host ? '<button class="btn ghost sm" data-act="allsubj">All</button>' : ''}</div><div class="chips">${subjChips}</div></div>
      <div class="setting"><span>Topics<small>“Current units” = what you’re studying now</small></span>${seg('units', ['all', 'current'], v => v === 'all' ? 'Everything' : 'Current units')}</div>
      <div class="setting"><span>Rounds</span>${seg('rounds', [3, 5, 8, 12])}</div>
      <div class="setting"><span>Seconds per round</span>${seg('time', [30, 45, 60, 90])}</div>
      <div class="setting"><span>Hints<small>A hinted answer scores half</small></span>${seg('hints', [true, false], v => v ? 'On' : 'Off')}</div>
      <div class="setting"><span>Bots</span>${seg('bots', [0, 1, 2, 3])}</div>
      ${host ? `<button class="btn primary block mt" data-act="start" ${s.subjects.length ? '' : 'disabled'}>Start game</button>` : `<p class="center muted mt">Waiting for the host to start…</p>`}
    </div>
  </div></div>`;
  if (patch) window.scrollTo(0, y);
  if (focusId) document.getElementById(focusId)?.focus();
}

function sideScores(live) {
  const sorted = view.order.slice().sort((a, b) => view.players[b].score - view.players[a].score);
  return `<h3>Scores</h3><ul class="scores">${sorted.map(id => { const p = view.players[id];
    const right = live ? `<span class="live">${view.counts?.[id] || 0} found</span>${view.done?.[id] && !p.bot ? '<span class="done">done</span>' : ''}` : '';
    return `<li class="${id === PID ? 'me' : ''}">${av(p, 's')}<span class="sp">${esc(p.name)}</span>${right}<span class="pts">${fmt(p.score)}</span></li>`; }).join('')}</ul>`;
}
function promptHead(pk) {
  return `<div class="prompt-top"><span class="tag">${esc(subjName(pk.subject))}</span><span class="muted small">${esc(unitName(pk.subject, pk.p.unit))}</span><span class="sp"></span><span class="eyebrow">Round ${Number(view.round)} of ${Number(view.settings.rounds)}</span></div>`;
}
function renderRound() {
  const pk = promptByKey(view.promptKey); if (!pk) return;
  const C = 2 * Math.PI * 31;
  app.innerHTML = `<div class="view">${topbar(`<button class="btn ghost sm" data-act="leave">Leave</button>`)}
  <div class="game">
    <div>
      <div class="card prompt-card">
        ${promptHead(pk)}
        <h1 class="prompt">${esc(pk.p.prompt)}</h1>
        <div class="ring" id="ring"><svg viewBox="0 0 72 72"><circle class="bg" cx="36" cy="36" r="31"/><circle class="fg" id="ringfg" cx="36" cy="36" r="31" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg><span id="secs"></span></div>
        <form class="entry" id="entry" autocomplete="off"><input class="input grow" id="guess" placeholder="Type an answer…" aria-label="Your answer" enterkeyhint="send" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false"><button class="btn ink" type="submit">Add</button></form>
        <div class="mine" id="mine"></div>
        <div id="hint"></div>
        <div class="roundbar">
          <span class="muted small" id="tally">${pk.p.answers.length} answers on the list</span><span class="sp"></span>
          ${view.settings.hints ? `<button class="btn sm" data-act="hint" id="hintbtn">Hint (${MAX_HINTS - local.hinted.size} left)</button>` : ''}
          <button class="btn sm" data-act="done" id="donebtn" aria-pressed="${local.done}">${local.done ? 'Not done yet' : 'I’m done'}</button>
        </div>
      </div>
    </div>
    <aside class="card side" id="side">${sideScores(true)}</aside>
  </div></div>`;
  drawMine(); drawHint();
  const g = $('#guess'); g.focus();
  $('#entry').addEventListener('submit', e => { e.preventDefault(); submitGuess(g.value); g.value = ''; g.focus(); });
  const tickUI = () => {
    const left = Math.max(0, viewDeadline - Date.now());
    const secs = Math.ceil(left / 1000);
    const el = $('#secs'); if (!el) return clearInterval(uiTimer);
    el.textContent = secs;
    $('#ringfg').style.strokeDashoffset = C * (1 - left / (view.settings.time * 1000));
    $('#ring').classList.toggle('low', secs <= 10);
    if (left <= 0) { g.disabled = true; g.placeholder = 'Time’s up…'; }
  };
  tickUI(); uiTimer = setInterval(tickUI, 200);
}
function submitGuess(raw) {
  raw = raw.trim(); if (!raw || view.phase !== 'round') return;
  const pk = promptByKey(view.promptKey);
  const i = matchAnswer(pk.p, raw);
  if (i < 0) { if (!local.wrong.some(w => norm(w) === norm(raw))) local.wrong.push(raw); drawMine(); return; }
  if (local.found.has(i)) { drawMine(i); toast('Already got that one'); return; }
  local.found.set(i, { hint: local.hinted.has(i), typed: raw });
  if (local.hintIdx === i) { local.hintIdx = null; drawHint(); }
  drawMine(); sendFound();
}
function drawMine(dup) {
  const pk = promptByKey(view.promptKey); const box = $('#mine'); if (!box) return;
  const ok = [...local.found.entries()].map(([i, v]) => `<span class="ans ok ${dup === i ? 'dup' : ''}">${esc(pk.p.answers[i].text)}${v.hint ? '<span class="h">hint</span>' : ''}</span>`);
  const no = local.wrong.slice(-6).map(w => `<span class="ans no" title="Not on the list">${esc(w)}</span>`);
  box.innerHTML = ok.concat(no).join('') || '<span class="muted small">Your answers show up here. Green dot = it’s on the list.</span>';
}
function drawHint() {
  const el = $('#hint'); if (!el) return;
  const btn = $('#hintbtn'); if (btn) { btn.textContent = `Hint (${MAX_HINTS - local.hinted.size} left)`; btn.disabled = local.hinted.size >= MAX_HINTS; }
  if (local.hintIdx == null) { el.innerHTML = ''; return; }
  const a = promptByKey(view.promptKey).p.answers[local.hintIdx];
  const shown = a.text.split(' ').map(w => w.length <= 2 ? w : w.slice(0, Math.min(2, Math.ceil(w.length / 3))) + '·'.repeat(Math.max(1, w.length - 2))).join(' ');
  const masked = maskWhy(a.why, a.text);
  el.innerHTML = `<div class="hintbox">Starts like <b>${esc(shown)}</b> — ${esc(masked)}</div>`;
}
function maskWhy(why, text) {
  let out = why || '';
  for (const w of text.split(/\s+/).filter(w => w.length > 3)) out = out.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '____');
  return out;
}
function useHint() {
  if (local.hinted.size >= MAX_HINTS) return;
  const pk = promptByKey(view.promptKey);
  const cands = pk.p.answers.map((a, i) => i).filter(i => !local.found.has(i) && !local.hinted.has(i));
  if (!cands.length) { toast('You’ve found them all'); return; }
  cands.sort((x, y) => pk.p.answers[x].tier - pk.p.answers[y].tier);
  const i = cands[Math.min(cands.length - 1, rand(Math.min(3, cands.length)))];
  local.hinted.add(i); local.hintIdx = i; drawHint();
  $('#guess')?.focus();
}

function boardHTML(p, per, opts = {}) {
  const order = p.answers.map((a, i) => i).sort((x, y) => p.answers[x].tier - p.answers[y].tier || x - y);
  return `<ol class="board">${order.map((i, k) => {
    const a = p.answers[i]; const r = per ? per[i] : null; const by = r?.by || [];
    const mine = by.some(b => b.pid === PID);
    const who = by.map(b => av(view.players[b.pid] || { name: '?', color: '#999' }, 's')).join('');
    const myHint = by.find(b => b.pid === PID)?.hint;
    const pts = by.length ? `<span class="pts">+${fmt(myHint ? Math.round(r.pts / 2) : r.pts)}${myHint ? ' <span class="muted">hint</span>' : ''}</span>` : `<span class="pts muted">${TIERS[a.tier].pts}</span>`;
    return `<li class="t${a.tier} ${per && !by.length ? 'none' : ''} ${mine ? 'mine' : ''}" style="animation-delay:${opts.noAnim ? 0 : 80 + k * 70}ms">
      ${bars(a.tier)}
      <div><div class="a">${esc(a.text)}</div><div class="meta"><span class="tn">${TIERS[a.tier].name}</span>${by.length > 1 ? `<span class="split">shared brain ÷${by.length}</span>` : ''}${per && !by.length ? '<span class="tn">nobody</span>' : ''}</div></div>
      <div class="who">${who}${pts}</div>
      <div class="why">${esc(a.why)}</div></li>`; }).join('')}</ol>`;
}
function renderReveal() {
  const pk = promptByKey(view.promptKey); const R = view.results;
  const last = view.round >= view.settings.rounds;
  const myWrong = local.round === view.round ? local.wrong : [];
  const wolf = R.wolves.map(w => `${av(view.players[w.pid], 's')} <span><b>${esc(view.players[w.pid].name)}</b> was the only one to find <b>${esc(pk.p.answers[w.i].text)}</b>. Lone wolf bonus +${LONE_WOLF}.</span>`).join('</div><div class="wolf">');
  const foundCount = R.per.filter(r => r.by.length).length;
  app.innerHTML = `<div class="view">${topbar(`<button class="btn ghost sm" data-act="leave">Leave</button>`)}
  <div class="game">
    <div class="card">
      ${promptHead(pk)}
      <h2>${esc(pk.p.prompt)}</h2>
      <p class="muted small" style="margin:6px 0 0">The room found ${foundCount} of ${pk.p.answers.length}. Read the ones nobody got — they’re the ones worth learning.</p>
      ${wolf ? `<div class="wolf">${wolf}</div>` : ''}
      ${boardHTML(pk.p, R.per)}
      ${myWrong.length ? `<p class="missed">Not on the list: ${myWrong.map(w => `<s>${esc(w)}</s>`).join(', ')}. If you think one should count, check the answer bank later.</p>` : ''}
      <div class="row mt2">${isHost ? `<button class="btn primary" data-act="${last ? 'final' : 'next'}">${last ? 'See final scores' : 'Next round'}</button>` : `<span class="muted">Waiting for the host…</span>`}</div>
    </div>
    <aside class="card side" id="side">${revealScores()}</aside>
  </div></div>`;
}
function revealScores() {
  const R = view.results;
  return `<h3>Scores</h3><ul class="scores">${view.order.slice().sort((a, b) => view.players[b].score - view.players[a].score).map(id => { const p = view.players[id];
    return `<li class="${id === PID ? 'me' : ''}">${av(p, 's')}<span class="sp">${esc(p.name)}</span><span class="pts">${fmt(p.score)}</span><span class="delta">+${fmt(R.roundPts[id] || 0)}</span></li>`; }).join('')}</ul>`;
}
function renderFinal() {
  const sorted = view.order.slice().sort((a, b) => view.players[b].score - view.players[a].score);
  const slot = (rank, cls) => { const id = sorted[rank]; if (!id) return '<div></div>'; const p = view.players[id];
    return `<div class="${cls}">${av(p)}<div class="nm">${esc(p.name)}</div><div class="sc">${fmt(p.score)}</div><div class="col">${rank + 1}</div></div>`; };
  const myRank = sorted.indexOf(PID) + 1;
  app.innerHTML = `<div class="view">${topbar()}
  <div class="card narrow center">
    <div class="eyebrow">Game over</div>
    <h2 class="mt">${sorted.length > 1 && view.players[sorted[0]].score === view.players[sorted[1]].score ? 'It’s a tie at the top.' : sorted[0] === PID ? 'You won. Pure instinct.' : `${esc(view.players[sorted[0]].name)} wins`}</h2>
    <p class="muted">${myRank ? `You came ${ordinal(myRank)} of ${sorted.length}.` : ''}</p>
    <div class="podium">${slot(1, 'p2')}${slot(0, 'p1')}${slot(2, 'p3')}</div>
    ${sorted.length > 3 ? `<ul class="scores" style="text-align:left;margin-top:10px">${sorted.slice(3).map((id, k) => `<li>${av(view.players[id], 's')}<span class="sp">${k + 4}. ${esc(view.players[id].name)}</span><span class="pts">${fmt(view.players[id].score)}</span></li>`).join('')}</ul>` : ''}
    <div class="row mt2" style="justify-content:center">
      ${isHost ? '<button class="btn primary" data-act="again">Play again</button>' : '<span class="muted">The host can start another game.</span>'}
      <button class="btn" data-act="review">Review this game’s answers</button>
    </div>
  </div></div>`;
}
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

/* ---------------- solo: flashcards ---------------- */
let study = {};
function subjectPicker(selected, act) {
  return `<div class="chips">${DATA.subjects.map(x => `<button class="chip" data-act="${act}" data-code="${x.subject}" aria-pressed="${selected.includes(x.subject)}">${esc(x.name)}</button>`).join('')}</div>`;
}
function unitSelect(codes, val) {
  if (codes.length !== 1) return '';
  const s = SUBJ[codes[0]];
  return `<label class="field mt"><span>Unit</span><select class="input" id="unit"><option value="all">All units</option>${s.units.map(u => `<option value="${u.id}" ${val === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>`;
}
function renderFlashSetup() {
  screen = 'flash';
  study = { codes: study.codes || [DATA.subjects[0]?.subject].filter(Boolean), unit: 'all' };
  drawFlashSetup();
}
function drawFlashSetup() {
  const mastery = store.get('cards', {});
  const n = cardsFor(study.codes, study.unit).length;
  const known = cardsFor(study.codes, study.unit).filter(c => (mastery[c.key] || 0) >= 2).length;
  app.innerHTML = `<div class="view">${topbar()}<div class="card narrow">
    <div class="eyebrow">Flashcards</div><h2 class="mt">What are we revising?</h2>
    <p class="muted small">Tap a card to flip it. “Again” brings it back in a few cards; “Got it” moves it on. Your progress stays on this device.</p>
    <div class="mt">${subjectPicker(study.codes, 'fsubj')}</div>
    ${unitSelect(study.codes, study.unit)}
    <p class="muted small mt">${n} cards · ${known} you’ve marked as known</p>
    <div class="row mt"><button class="btn primary" data-act="fstart" ${n ? '' : 'disabled'}>Start</button><label class="row" style="align-items:center;gap:6px"><input type="checkbox" id="unknownOnly"> <span class="small">Only cards I don’t know yet</span></label></div>
  </div></div>`;
  $('#unit')?.addEventListener('change', e => { study.unit = e.target.value; drawFlashSetup(); });
}
function cardsFor(codes, unit) {
  const out = [];
  codes.forEach(c => (SUBJ[c]?.cards || []).forEach((card, i) => { if (unit === 'all' || card.unit === unit) out.push({ ...card, subject: c, key: c + ':' + i + ':' + card.front.slice(0, 24) }); }));
  return out;
}
function startFlash() {
  const mastery = store.get('cards', {});
  let deck = cardsFor(study.codes, study.unit);
  if ($('#unknownOnly')?.checked) deck = deck.filter(c => (mastery[c.key] || 0) < 2);
  if (!deck.length) { toast('Nothing left to learn here. Untick the box to go again.'); return; }
  study.deck = shuffle(deck); study.total = deck.length; study.doneN = 0; study.flipped = false;
  drawCard();
}
function drawCard() {
  const c = study.deck[0];
  if (!c) {
    app.innerHTML = `<div class="view">${topbar()}<div class="card narrow center"><div class="eyebrow">Deck finished</div><h2 class="mt">All ${study.total} cards done</h2><p class="muted">Come back tomorrow and do the ones you marked “Again” first. Spacing it out is what makes it stick.</p><div class="row mt" style="justify-content:center"><button class="btn primary" data-act="flash">Another deck</button><button class="btn" data-act="home">Home</button></div></div></div>`;
    return;
  }
  app.innerHTML = `<div class="view">${topbar(`<span class="mono small muted">${study.doneN}/${study.total}</span>`)}<div class="narrow">
    <div class="progress"><i style="width:${100 * study.doneN / study.total}%"></i></div>
    <div class="flash"><button class="fc ${study.flipped ? 'flipped' : ''}" id="fc" aria-label="Flip card">
      <div class="face front"><span class="eyebrow">${esc(subjName(c.subject))} · ${esc(unitName(c.subject, c.unit))}</span><div class="t">${esc(c.front)}</div><span class="muted small">Tap or press space to flip</span></div>
      <div class="face back"><span class="eyebrow">${esc(c.front)}</span><div class="t">${esc(c.back)}</div></div>
    </button></div>
    <div class="row" style="justify-content:center"><button class="btn" data-act="again1">Again</button><button class="btn ink" data-act="gotit">Got it</button></div>
  </div></div>`;
  $('#fc').addEventListener('click', () => { study.flipped = !study.flipped; $('#fc').classList.toggle('flipped', study.flipped); });
}
function rateCard(good) {
  const c = study.deck.shift(); const m = store.get('cards', {});
  if (good) { m[c.key] = (m[c.key] || 0) + 1; study.doneN++; }
  else { m[c.key] = 0; study.deck.splice(Math.min(3, study.deck.length), 0, c); }
  store.set('cards', m); study.flipped = false; drawCard();
}

/* ---------------- solo: quiz ---------------- */
function renderQuizSetup() {
  screen = 'quiz';
  study = { codes: study.codes || [DATA.subjects[0]?.subject].filter(Boolean), unit: 'all' };
  drawQuizSetup();
}
function quizFor(codes, unit) {
  const out = [];
  codes.forEach(c => (SUBJ[c]?.quiz || []).forEach(q => { if (unit === 'all' || q.unit === unit) out.push({ ...q, subject: c }); }));
  return out;
}
function drawQuizSetup() {
  const n = quizFor(study.codes, study.unit).length;
  app.innerHTML = `<div class="view">${topbar()}<div class="card narrow">
    <div class="eyebrow">Quiz</div><h2 class="mt">10 questions, explained as you go</h2>
    <p class="muted small">One 50/50 hint per question removes two wrong answers. Questions you miss come back at the end.</p>
    <div class="mt">${subjectPicker(study.codes, 'qsubj')}</div>
    ${unitSelect(study.codes, study.unit)}
    <p class="muted small mt">${n} questions in this mix</p>
    <button class="btn primary mt" data-act="qstart" ${n ? '' : 'disabled'}>Start quiz</button>
  </div></div>`;
  $('#unit')?.addEventListener('change', e => { study.unit = e.target.value; drawQuizSetup(); });
}
function startQuiz(list) {
  const qs = list || shuffle(quizFor(study.codes, study.unit)).slice(0, 10);
  study.qs = qs.map(q => { const idx = shuffle(q.choices.map((_, i) => i)); return { ...q, order: idx }; });
  study.qi = 0; study.right = 0; study.missed = [];
  drawQ();
}
function drawQ() {
  const q = study.qs[study.qi];
  if (!q) {
    app.innerHTML = `<div class="view">${topbar()}<div class="card narrow">
      <div class="eyebrow">Quiz done</div><h2 class="mt">${study.right} / ${study.qs.length}</h2>
      ${study.missed.length ? `<h3 class="mt2">Worth another look</h3>${study.missed.map(m => `<div class="explain"><b>${esc(m.q)}</b><br>Answer: ${esc(m.choices[m.answer])}<br><span class="muted small">${esc(m.explain)}</span></div>`).join('')}` : '<p class="muted">Clean sweep.</p>'}
      <div class="row mt2">${study.missed.length ? '<button class="btn primary" data-act="qretry">Retry the ones I missed</button>' : ''}<button class="btn" data-act="quiz">New quiz</button><button class="btn ghost" data-act="home">Home</button></div>
    </div></div>`;
    return;
  }
  app.innerHTML = `<div class="view">${topbar(`<span class="mono small muted">${study.qi + 1}/${study.qs.length}</span>`)}<div class="card narrow">
    <div class="progress"><i style="width:${100 * study.qi / study.qs.length}%"></i></div>
    <div class="prompt-top mt"><span class="tag">${esc(subjName(q.subject))}</span><span class="muted small">${esc(unitName(q.subject, q.unit))}</span></div>
    <div class="q">${esc(q.q)}</div>
    <div class="choices" id="choices">${q.order.map((ci, k) => `<button class="choice" data-act="pick" data-ci="${ci}"><span class="k">${'ABCD'[k]}</span><span>${esc(q.choices[ci])}</span></button>`).join('')}</div>
    <div id="qfoot" class="row mt"><button class="btn sm" data-act="fifty" id="fifty">50/50 hint</button></div>
  </div></div>`;
}
function pickChoice(ci) {
  const q = study.qs[study.qi]; const box = $('#choices'); if (box.classList.contains('locked')) return;
  box.classList.add('locked');
  const ok = ci === q.answer;
  if (ok) study.right++; else study.missed.push(q);
  $$('.choice', box).forEach(b => { const c = +b.dataset.ci; if (c === q.answer) b.classList.add('right'); else if (c === ci) b.classList.add('wrong'); });
  $('#qfoot').innerHTML = `<div class="explain grow"><b>${ok ? 'Right.' : 'Not quite.'}</b> ${esc(q.explain)}</div><button class="btn primary" data-act="qnext" id="qnext">${study.qi + 1 < study.qs.length ? 'Next' : 'See score'}</button>`;
  $('#qnext').focus();
}
function fifty() {
  const q = study.qs[study.qi];
  const wrong = shuffle(q.choices.map((_, i) => i).filter(i => i !== q.answer)).slice(0, 2);
  $$('.choice').forEach(b => { if (wrong.includes(+b.dataset.ci)) b.classList.add('gone'); });
  $('#fifty').disabled = true;
}

/* ---------------- answer bank ---------------- */
function renderLearn(onlyKeys) {
  screen = 'learn';
  study = { codes: study.codes?.length ? study.codes : DATA.subjects.map(s => s.subject), q: '', only: onlyKeys || null };
  drawLearn();
}
function drawLearn() {
  let list = study.only ? study.only.map(promptByKey).filter(Boolean) : allPrompts(study.codes);
  const q = norm(study.q);
  if (q) list = list.filter(x => norm(x.p.prompt + ' ' + x.p.answers.map(a => a.text + ' ' + a.why).join(' ')).includes(q));
  const body = list.map(x => `<details class="pr"><summary><span class="tag">${esc(subjName(x.subject))}</span><span class="sp">${esc(x.p.prompt)}</span><span class="muted small mono">${x.p.answers.length}</span></summary>${boardHTML(x.p, null, { noAnim: true })}</details>`).join('');
  const keepFocus = document.activeElement?.id === 'q';
  app.innerHTML = `<div class="view">${topbar()}<div class="narrow" style="max-width:760px">
    <div class="card">
      <div class="eyebrow">Answer bank</div><h2 class="mt">${study.only ? 'This game’s prompts' : 'Every prompt, every answer'}</h2>
      <p class="muted small">More bars = rarer. Use it to learn the deep cuts before a game, or to check why an answer counted.</p>
      ${study.only ? `<div class="row mt">${view ? '<button class="btn ink sm" data-act="toroom">Back to the room</button>' : ''}<button class="btn sm" data-act="learnall">Show all subjects</button></div>` : `<div class="mt">${subjectPicker(study.codes, 'lsubj')}</div>`}
      <input class="input search" id="q" placeholder="Search prompts and answers" value="${esc(study.q)}">
      <p class="muted small">${list.length} prompts</p>
    </div>
    <div class="plist mt">${body || '<div class="card muted">No prompts match that search.</div>'}</div>
  </div></div>`;
  const qi = $('#q'); qi.addEventListener('input', () => { study.q = qi.value; drawLearn(); });
  if (keepFocus) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
}

/* ---------------- actions ---------------- */
function toggleIn(arr, v) { return arr.includes(v) ? arr.filter(x => x !== v) : arr.concat(v); }
function act(a, el) {
  switch (a) {
    case 'home': if ((room && !room.offline && room.phase !== 'final') || (hostConn && view && view.phase !== 'final')) { if (!confirm(isHost ? 'Leave and close the room for everyone?' : 'Leave this game?')) return; }
      history.replaceState(null, '', location.pathname); renderHome(); break;
    case 'host': saveName(); hostRoom(); break;
    case 'bots': saveName(); hostRoom({ offline: true, bots: 3 }); break;
    case 'join': { const n = saveName(); const c = ($('#code')?.value || '').toUpperCase(); if (!/^[A-Z]{4}$/.test(c)) { toast('Room codes are 4 letters'); $('#code')?.focus(); return; } if (!n) { toast('Add your name first'); $('#name')?.focus(); return; } joinRoom(c); break; }
    case 'rejoin': joinRoom(el.dataset.code); break;
    case 'leave': if (confirm(isHost && !view?.offline ? 'Leave and close the room for everyone?' : 'Leave this game?')) { history.replaceState(null, '', location.pathname); renderHome(); } break;
    case 'copy': navigator.clipboard?.writeText(inviteLink()).then(() => toast('Invite link copied'), () => toast(inviteLink())); break;
    case 'share': navigator.share?.({ title: 'Instinct', text: `Join my Instinct room: ${view.code}`, url: inviteLink() }).catch(() => {}); break;
    case 'subj': if (!isHost) return; room.settings.subjects = toggleIn(room.settings.subjects, el.dataset.code); store.set('subjects', room.settings.subjects); broadcast(); break;
    case 'allsubj': if (!isHost) return; room.settings.subjects = DATA.subjects.map(s => s.subject); store.set('subjects', room.settings.subjects); broadcast(); break;
    case 'set': {
      if (!isHost) return; const k = el.dataset.key; let v = el.dataset.val;
      v = v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v;
      room.settings[k] = v; if (k === 'bots') syncBots();
      const { bots, ...keep } = room.settings; store.set('settings', { rounds: keep.rounds, time: keep.time, hints: keep.hints, units: keep.units });
      broadcast(); break;
    }
    case 'start': if (isHost && room.phase === 'lobby' && room.settings.subjects.length) startGame(); break;
    case 'next': if (isHost && room.phase === 'reveal' && room.round < room.settings.rounds) nextRound(); break;
    case 'final': if (isHost && room.phase === 'reveal') finishGame(); break;
    case 'again': if (isHost && room.phase === 'final') backToLobby(); break;
    case 'toroom': screen = 'room'; renderRoom(); break;
    case 'review': { const keys = view.history.slice(); renderLearn(keys); break; }
    case 'hint': useHint(); break;
    case 'done': local.done = !local.done; el.textContent = local.done ? 'Not done yet' : 'I’m done'; el.setAttribute('aria-pressed', local.done); hostAct({ t: 'done', pid: PID, round: view.round, done: local.done }); break;
    case 'flash': renderFlashSetup(); break;
    case 'fsubj': study.codes = toggleIn(study.codes, el.dataset.code); study.unit = 'all'; drawFlashSetup(); break;
    case 'fstart': startFlash(); break;
    case 'again1': rateCard(false); break;
    case 'gotit': rateCard(true); break;
    case 'quiz': renderQuizSetup(); break;
    case 'qsubj': study.codes = toggleIn(study.codes, el.dataset.code); study.unit = 'all'; drawQuizSetup(); break;
    case 'qstart': startQuiz(); break;
    case 'pick': pickChoice(+el.dataset.ci); break;
    case 'qnext': study.qi++; drawQ(); break;
    case 'qretry': startQuiz(study.missed); break;
    case 'fifty': fifty(); break;
    case 'learn': renderLearn(); break;
    case 'learnall': study.only = null; study.codes = DATA.subjects.map(s => s.subject); drawLearn(); break;
    case 'lsubj': study.codes = toggleIn(study.codes, el.dataset.code); drawLearn(); break;
  }
}
document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (el && !el.disabled) { e.preventDefault(); act(el.dataset.act, el); } });
document.addEventListener('keydown', e => {
  if (screen === 'flash' && study.deck?.length && !/INPUT|SELECT/.test(document.activeElement?.tagName)) {
    const onButton = document.activeElement?.tagName === 'BUTTON' && document.activeElement.id !== 'fc';
    if (e.key === ' ' && !onButton) { e.preventDefault(); $('#fc')?.click(); }
    if (e.key === 'ArrowRight' || (e.key === 'Enter' && !onButton)) { e.preventDefault(); rateCard(true); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); rateCard(false); }
  }
});

// test hooks (used by the automated checks)
window.__instinct = { norm, matchAnswer, promptByKey, get view() { return view; }, get room() { return room; } };

renderHome();
})();
