/* Orbit Radar — live board of new Solana meme coins.
   Data arrives from the Orbit server over Server-Sent Events (/api/pulse/stream).
   Trades: the server builds an unsigned transaction, the user's own wallet signs and sends it. */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const COLS = ['new', 'final', 'migrated'];
const B58RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/* ---------- logo (same pixel planet as the home page) ---------- */
(function logo() {
  const rows = ["..............m.", "......kkkk......", "....kkaaaakk....", "...kawwaaaaak...", "..kawaaaaaaaak..", "..kaaaaaaaaaak..", "kkkkkkkkkkkkkkkk", "kppppppppppppppk", "kkkkkkkkkkkkkkkk", "..kbbbbbbbbbbk..", "..kbbbbbbbbbbk..", "...kbbbbbbbbk...", "....kkbbbbkk....", "......kkkk......"];
  const pal = { k: '#0d0926', w: '#fff8e0', a: '#ffc83d', b: '#d98a1c', p: '#ff5fa2', m: '#5cf2c2' };
  const ns = 'http://www.w3.org/2000/svg';
  $$('svg.logo').forEach(svg => rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (!pal[ch]) return; const e = document.createElementNS(ns, 'rect');
    e.setAttribute('x', x); e.setAttribute('y', y + 1); e.setAttribute('width', 1); e.setAttribute('height', 1); e.setAttribute('fill', pal[ch]); svg.appendChild(e);
  })));
})();

/* ---------- formatting ---------- */
const usdC = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const fmtUsd = v => (v > 0 ? usdC.format(v) : '—');
function ago(ms) {
  if (!ms) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return s + 's'; const m = Math.floor(s / 60); if (m < 60) return m + 'm';
  const h = Math.floor(m / 60); return h < 48 ? h + 'h' : Math.floor(h / 24) + 'd';
}
const short = a => (a ? a.slice(0, 4) + '…' + a.slice(-4) : '');
function hash(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
const identCache = new Map();
function identicon(seed) {
  if (identCache.has(seed)) return identCache.get(seed);
  const c = document.createElement('canvas'); c.width = 7; c.height = 7; const x = c.getContext('2d');
  const pal = ['#ffc83d', '#ff5fa2', '#5cf2c2', '#59c3ff', '#b18cff', '#ff8a3d']; let h = hash(seed);
  x.fillStyle = '#0d0926'; x.fillRect(0, 0, 7, 7); x.fillStyle = pal[h % pal.length];
  for (let yy = 1; yy < 6; yy++) for (let xx = 1; xx < 4; xx++) { h = Math.imul(h ^ (h >>> 13), 1103515245) >>> 0; if (h & 1) { x.fillRect(xx, yy, 1, 1); x.fillRect(6 - xx, yy, 1, 1); } }
  const url = c.toDataURL(); identCache.set(seed, url); return url;
}
function drawIdentTo(canvas, seed) {
  const x = canvas.getContext('2d'); const img = new Image(); img.onload = () => { x.imageSmoothingEnabled = false; x.clearRect(0, 0, canvas.width, canvas.height); x.drawImage(img, 0, 0, canvas.width, canvas.height); }; img.src = identicon(seed);
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function safeHref(u) { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : ''; } catch { return ''; } }
function setImg(img, t) {
  const fallback = identicon(t.mint);
  const src = safeHref(t.image) || fallback;
  if (img.dataset.src === src) return;
  img.dataset.src = src; img.src = src;
  img.onerror = () => { img.onerror = null; img.src = fallback; };
}
function pbar(container, pct, segs = 16) {
  if (container.children.length !== segs) { container.textContent = ''; for (let i = 0; i < segs; i++) container.appendChild(el('i')); }
  const on = Math.round((Math.max(0, Math.min(100, pct)) / 100) * segs);
  [...container.children].forEach((c, i) => c.classList.toggle('on', i < on));
}

/* ---------- toasts ---------- */
function toast(msg, kind = 'info', link) {
  const t = el('div', 'toast ' + kind); t.appendChild(el('span', '', msg));
  if (link) { const a = el('a', '', link.text); a.href = link.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; t.appendChild(a); }
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), kind === 'err' ? 8000 : 6000);
}

/* ---------- settings ---------- */
const settings = Object.assign({ qb: 0.1, slip: 15, prio: 0.0005 }, store.get('orbit-trade', {}));
$('#qbAmt').value = settings.qb; $('#slip').value = settings.slip; $('#prio').value = settings.prio;
function saveSettings() {
  const qb = +$('#qbAmt').value, slip = +$('#slip').value, prio = +$('#prio').value;
  if (qb > 0 && qb <= 100) settings.qb = qb; if (slip >= 0.5 && slip <= 50) settings.slip = slip; if (prio >= 0 && prio <= 0.05) settings.prio = prio;
  store.set('orbit-trade', settings); markPresets(); $$('.qbuy').forEach(b => { b.textContent = '⚡ ' + settings.qb; });
}
['#qbAmt', '#slip', '#prio'].forEach(s => $(s).addEventListener('change', saveSettings));
function markPresets() { $$('#qbPresets button').forEach(b => b.classList.toggle('on', +b.dataset.v === settings.qb)); }
$('#qbPresets').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $('#qbAmt').value = b.dataset.v; saveSettings(); });
markPresets();

/* ---------- launchpads ---------- */
const PADS = { pump: 'PUMP', bonk: 'BONK', launchlab: 'LLAB', bags: 'BAGS', meteora: 'MET' };
const PAD_NAMES = { pump: 'Pump.fun', bonk: 'LetsBonk', launchlab: 'Raydium LaunchLab', bags: 'Bags', meteora: 'Meteora' };
const padsOn = Object.assign({ pump: true, bonk: true, launchlab: true, bags: true, meteora: true }, store.get('orbit-pads', {}));
(function buildPads() {
  const box = $('#pads');
  Object.entries(PADS).forEach(([k, lab]) => {
    const b = el('button', 'pad-' + k + (padsOn[k] ? ' on' : ''), lab); b.type = 'button'; b.title = PAD_NAMES[k]; b.setAttribute('aria-pressed', String(!!padsOn[k]));
    b.addEventListener('click', () => { padsOn[k] = !padsOn[k]; b.classList.toggle('on', padsOn[k]); b.setAttribute('aria-pressed', String(padsOn[k])); store.set('orbit-pads', padsOn); renderAll(true); });
    box.appendChild(b);
  });
})();

/* ---------- filters ---------- */
const filters = Object.assign({ new: {}, final: {}, migrated: {} }, store.get('orbit-filters', {}));
let query = '';
$('#search').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); renderAll(true); });
function passes(t, col) {
  const f = filters[col] || {};
  if (padsOn[t.launchpad || 'pump'] === false) return false;
  if (query && !(`${t.name} ${t.symbol} ${t.mint}`.toLowerCase().includes(query))) return false;
  if (f.minMc && !(t.mcUsd >= f.minMc)) return false;
  if (f.maxMc && !(t.mcUsd <= f.maxMc)) return false;
  if (f.minVol && !(t.volUsd >= f.minVol)) return false;
  if (f.minHold && !(t.holders >= f.minHold)) return false;
  if (f.maxTop && t.top10Pct !== null && t.top10Pct > f.maxTop) return false;
  if (f.maxDev && t.devPct !== null && t.devPct > f.maxDev) return false;
  if (f.noDevSold && t.devSold) return false;
  if (f.socials && !(t.twitter || t.telegram || t.website)) return false;
  if (f.image && !t.image) return false;
  if (f.hide) { const words = f.hide.toLowerCase().split(',').map(w => w.trim()).filter(Boolean); const n = `${t.name} ${t.symbol}`.toLowerCase(); if (words.some(w => n.includes(w))) return false; }
  return true;
}
let fpCol = null;
function markFilterButtons() { COLS.forEach(c => { const f = filters[c] || {}; $(`.fbtn[data-filter="${c}"]`).classList.toggle('on', Object.values(f).some(Boolean)); }); }
$$('.fbtn').forEach(b => b.addEventListener('click', e => {
  e.stopPropagation(); fpCol = b.dataset.filter; const f = filters[fpCol] || {};
  $('#fpTitle').textContent = 'Filters · ' + ({ new: 'New Pairs', final: 'Final Stretch', migrated: 'Migrated' })[fpCol];
  $('#fMinHold').value = f.minHold || ''; $('#fMaxTop').value = f.maxTop || ''; $('#fMaxDev').value = f.maxDev || ''; $('#fNoDevSold').checked = !!f.noDevSold;
  $('#fMinMc').value = f.minMc || ''; $('#fMaxMc').value = f.maxMc || ''; $('#fMinVol').value = f.minVol || ''; $('#fSocials').checked = !!f.socials; $('#fImage').checked = !!f.image; $('#fHide').value = f.hide || '';
  const pop = $('#filterPop'); pop.hidden = false; const r = b.getBoundingClientRect();
  pop.style.top = Math.min(innerHeight - pop.offsetHeight - 10, r.bottom + 8) + 'px'; pop.style.left = Math.max(16, Math.min(innerWidth - pop.offsetWidth - 16, r.right - pop.offsetWidth)) + 'px';
}));
$('#fApply').addEventListener('click', () => {
  filters[fpCol] = { minHold: +$('#fMinHold').value || 0, maxTop: +$('#fMaxTop').value || 0, maxDev: +$('#fMaxDev').value || 0, noDevSold: $('#fNoDevSold').checked, minMc: +$('#fMinMc').value || 0, maxMc: +$('#fMaxMc').value || 0, minVol: +$('#fMinVol').value || 0, socials: $('#fSocials').checked, image: $('#fImage').checked, hide: $('#fHide').value.trim() };
  store.set('orbit-filters', filters); $('#filterPop').hidden = true; markFilterButtons(); renderAll(true);
});
$('#fReset').addEventListener('click', () => { filters[fpCol] = {}; store.set('orbit-filters', filters); $('#filterPop').hidden = true; markFilterButtons(); renderAll(true); });
document.addEventListener('pointerdown', e => { const pop = $('#filterPop'); if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.fbtn')) pop.hidden = true; });
markFilterButtons();

/* ---------- mobile column tabs ---------- */
$$('.coltabs button').forEach(b => b.addEventListener('click', () => {
  $('#cols').dataset.active = b.dataset.tab; $$('.coltabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
}));

/* ---------- board rendering ---------- */
let snap = { new: [], final: [], migrated: [] };
const paused = { new: false, final: false, migrated: false };
const cards = new Map(); // `${col}:${mint}` -> element
let firstRender = true;

function makeCard(t, col) {
  const c = el('article', 'card'); c.tabIndex = 0; c.dataset.mint = t.mint;
  const th = el('div', 'thumb'); const img = el('img'); img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.width = 56; img.height = 56;
  const ring = el('div', 'ring'); ring.appendChild(el('i')); const pad = el('span', 'pad'); th.append(img, ring, pad);
  const top = el('div', 'c-top'); const name = el('b'); const sym = el('span', 'sym'); const cp = el('button', 'copy', '⧉'); cp.type = 'button'; cp.title = 'Copy address'; cp.dataset.act = 'copy'; top.append(name, sym, cp);
  const mid = el('div', 'c-mid'); const age = el('span', 'age'); const soc = el('span', 'soc'); const dev = el('span', 'dev'); const chg = el('span', 'chg'); mid.append(age, soc, dev, chg);
  const bot = el('div', 'c-bot'); const bar = el('div', 'pbar'); const pct = el('span', 'pct'); bot.append(bar, pct);
  const right = el('div', 'c-right'); const mc = el('span', 'mc'); const vol = el('span', 'vol'); const tx = el('span', 'tx'); right.append(mc, vol, tx);
  const qb = el('button', 'qbuy', '⚡ ' + settings.qb); qb.type = 'button'; qb.dataset.act = 'qbuy'; qb.title = 'Buy now with the quick-buy amount';
  const safe = el('div', 'c-safe');
  c.append(th, top, mid, bot, right, qb, safe);
  c._r = { safe, pad, img, ring: ring.firstChild, name, sym, age, soc, dev, chg, bar, pct, mc, vol, tx };
  return c;
}
function updateCard(c, t, col) {
  const r = c._r; c._t = t;
  setImg(r.img, t);
  r.ring.style.width = Math.max(0, Math.min(100, t.progress)) + '%';
  r.name.textContent = t.name || t.symbol || short(t.mint); r.sym.textContent = t.symbol ? '$' + t.symbol : '';
  r.age.dataset.t = col === 'migrated' && t.migratedAt ? t.migratedAt : t.createdAt; r.age.textContent = ago(+r.age.dataset.t);
  const links = [['X', t.twitter], ['TG', t.telegram], ['WEB', t.website]].filter(l => safeHref(l[1]));
  const key = links.map(l => l[1]).join('|');
  if (r.soc.dataset.k !== key) { r.soc.dataset.k = key; r.soc.textContent = ''; links.forEach(([lab, href]) => { const a = el('a', '', lab); a.href = safeHref(href); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.dataset.act = 'link'; r.soc.appendChild(a); }); }
  r.dev.textContent = t.devBuySol > 0 ? `DEV ${t.devBuySol}◎` : '';
  if (t.change5m !== null && t.change5m !== undefined && isFinite(t.change5m)) { r.chg.textContent = (t.change5m >= 0 ? '▲' : '▼') + Math.abs(t.change5m).toFixed(1) + '% 5M'; r.chg.className = 'chg ' + (t.change5m >= 0 ? 'up' : 'dn'); } else r.chg.textContent = '';
  pbar(r.bar, t.progress); r.pct.textContent = col === 'migrated' ? 'DONE' : (t.progressApprox ? '≈' : '') + t.progress.toFixed(0) + '%';
  const lp = t.launchpad || 'pump'; r.pad.textContent = PADS[lp] || lp.toUpperCase(); r.pad.className = 'pad pad-' + lp; r.pad.title = PAD_NAMES[lp] || lp;
  renderSafety(r.safe, t);
  r.mc.innerHTML = ''; r.mc.append(el('small', '', 'MC '), document.createTextNode(fmtUsd(t.mcUsd)));
  r.vol.innerHTML = ''; r.vol.append(el('small', '', 'V '), document.createTextNode(fmtUsd(t.volUsd)));
  r.tx.innerHTML = ''; r.tx.append(el('small', '', 'TX '), el('span', 'b', String(t.buys || 0)), document.createTextNode('/'), el('span', 's', String(t.sells || 0)));
}
function chip(box, label, value, cls, title) {
  const c = el('span', 'sf ' + (cls || '')); c.title = title || ''; c.append(document.createTextNode(label + ' ')); c.appendChild(el('b', '', value)); box.appendChild(c);
}
function renderSafety(box, t) {
  const key = [t.holders, t.top10Pct, t.devPct, t.devSold, t.snipers, t.sniperPct].join('|');
  if (box.dataset.k === key) return; box.dataset.k = key; box.textContent = '';
  if (t.holders !== null && t.holders !== undefined) chip(box, 'HOLD', t.holders + (t.holdersCapped ? '+' : ''), t.holders >= 50 ? 'good' : '', 'Wallets holding this coin');
  if (t.top10Pct !== null && t.top10Pct !== undefined) chip(box, 'TOP10', t.top10Pct.toFixed(0) + '%', t.top10Pct > 30 ? 'bad' : 'good', 'Share of supply held by the 10 biggest wallets, not counting the bonding curve or pool');
  if (t.devSold) { const c = el('span', 'sf alert', 'DEV SOLD'); c.title = 'The creator has sold some of their coins'; box.appendChild(c); }
  else if (t.devPct !== null && t.devPct !== undefined) chip(box, 'DEV', t.devPct.toFixed(1) + '%', t.devPct > 10 ? 'bad' : 'good', 'Share of supply the creator still holds');
  if (t.snipers) chip(box, 'SNIPE', t.snipers + (t.sniperPct !== null ? ' · ' + t.sniperPct.toFixed(0) + '%' : ''), (t.sniperPct || 0) > 10 ? 'bad' : '', 'Wallets that bought in the first 3 seconds, and the share they still hold');
}

function renderCol(col, force) {
  if (paused[col] && !force) return;
  const list = $('#list-' + col);
  const items = (snap[col] || []).filter(t => passes(t, col));
  $('#cnt-' + col).textContent = items.length;
  const keep = new Set();
  let prev = null;
  const empty = list.querySelector('.empty');
  if (items.length && empty) empty.hidden = true; else if (!items.length && empty) empty.hidden = false;
  for (const t of items) {
    const key = col + ':' + t.mint; keep.add(key);
    let c = cards.get(key);
    if (!c) { c = makeCard(t, col); cards.set(key, c); if (!firstRender) c.classList.add('fresh'); }
    updateCard(c, t, col);
    const ref = prev ? prev.nextSibling : list.firstChild;
    if (c !== ref) list.insertBefore(c, ref);
    prev = c;
  }
  for (const [key, c] of cards) if (key.startsWith(col + ':') && !keep.has(key)) { c.remove(); cards.delete(key); }
}
function renderAll(force) { COLS.forEach(c => renderCol(c, force)); firstRender = false; }
setInterval(() => { $$('.age').forEach(a => { a.textContent = ago(+a.dataset.t); }); }, 1000);

// Pause a column while the pointer is over it, so cards don't move under the cursor.
$$('.col').forEach(sec => {
  const col = sec.dataset.col; const chip = sec.querySelector('.paused'); const list = sec.querySelector('.list');
  list.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { paused[col] = true; chip.hidden = false; } });
  list.addEventListener('pointerleave', () => { paused[col] = false; chip.hidden = true; renderCol(col, true); });
});

// card interactions
$('#cols').addEventListener('click', e => {
  const card = e.target.closest('.card'); if (!card) return;
  const act = e.target.closest('[data-act]'); const t = card._t;
  if (act && act.dataset.act === 'link') return;
  if (act && act.dataset.act === 'copy') { copy(t.mint); return; }
  if (act && act.dataset.act === 'qbuy') { trade('buy', t, settings.qb, act); return; }
  openDrawer(t);
});
$('#cols').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('card')) openDrawer(e.target._t); });
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Address copied', 'ok'); } catch { toast('Copy this address: ' + text, 'info'); }
}

/* ---------- live feed ---------- */
let gotFirst = false;
function setFeed(text, cls) { const f = $('#feedState'); f.className = 'feed label ' + (cls || ''); f.lastChild.textContent = text; }
function onSnapshot(s) {
  snap = s; gotFirst = true;
  $('#demoBanner').hidden = !s.mock;
  $$('.fmin').forEach(x => { x.textContent = s.finalMin; });
  if (s.solUsd) $('#solChip').textContent = 'SOL $' + s.solUsd.toFixed(2);
  setFeed(s.mock ? 'Demo feed' : s.liveTrades ? 'Live · every trade' : 'Live · launches instant, stats every few seconds', 'live');
  renderAll(false);
  if (drawerToken) { const t = [...s.new, ...s.final, ...s.migrated].find(x => x.mint === drawerToken.mint); if (t) fillDrawer(t); }
}
function connectFeed() {
  const es = new EventSource('/api/pulse/stream');
  es.onmessage = e => { try { onSnapshot(JSON.parse(e.data)); } catch {} };
  es.onerror = () => setFeed(gotFirst ? 'Reconnecting… showing the last update' : 'Connecting…', 'warn');
}
connectFeed();

/* ---------- drawer ---------- */
let drawerToken = null, side = 'buy';
function openDrawer(t) { drawerToken = t; $('#drawer').hidden = false; $('#trMsg').textContent = ''; $('#trMsg').className = 'tr-msg'; fillDrawer(t, true); }
$('#drClose').addEventListener('click', () => { $('#drawer').hidden = true; drawerToken = null; $('#drChart').textContent = ''; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#drawer').hidden) $('#drClose').click(); $('#filterPop').hidden = true; $('#walletModal').hidden = true; } });
function fillDrawer(t, first) {
  drawerToken = t;
  const d = $('#drawer'); d.classList.remove('new', 'final', 'migrated'); d.classList.add(t.status);
  setImg($('#drImg'), t);
  $('#drName').textContent = t.name || short(t.mint); $('#drSym').textContent = (t.symbol ? '$' + t.symbol + ' · ' : '') + ({ new: 'New pair', final: 'Final stretch', migrated: 'Migrated' })[t.status];
  $('#drMint').textContent = t.mint; $('#drDesc').textContent = t.description || '';
  const pctOr = v => (v === null || v === undefined ? '—' : v.toFixed(1) + '%');
  const stats = [['Market cap', fmtUsd(t.mcUsd)], ['Volume', fmtUsd(t.volUsd)], ['Buys / sells', `${t.buys || 0} / ${t.sells || 0}`],
    ['Holders', t.holders === null || t.holders === undefined ? '—' : t.holders + (t.holdersCapped ? '+' : '')], ['Top 10 hold', pctOr(t.top10Pct)], ['Dev holds', t.devSold ? 'Sold' : pctOr(t.devPct)],
    ['Snipers', t.snipers ? t.snipers + (t.sniperPct !== null ? ' · ' + pctOr(t.sniperPct) : '') : '—'], ['Launchpad', PAD_NAMES[t.launchpad] || 'Pump.fun'], ['Age', ago(t.createdAt)],
    ['Dev buy', t.devBuySol ? t.devBuySol + ' SOL' : '—'], ['Creator', t.creator ? short(t.creator) : '—'], ['Status', ({ new: 'New pair', final: 'Final stretch', migrated: 'Migrated' })[t.status]]];
  const box = $('#drStats'); box.textContent = '';
  stats.forEach(([k, v]) => { const c = el('div'); c.append(el('span', 'label', k), el('b', '', v)); box.appendChild(c); });
  pbar($('#drBar'), t.progress, 24); $('#drProg').textContent = t.status === 'migrated' ? 'Bonding curve complete' : `Bonding curve ${t.progressApprox ? '≈' : ''}${t.progress.toFixed(1)}%`;
  if (first) {
    const ch = $('#drChart'); ch.textContent = '';
    if (snap.mock) { ch.textContent = 'Charts load from DexScreener for real coins. This is a simulated demo coin.'; }
    else {
    const f = document.createElement('iframe'); f.title = 'Price chart'; f.loading = 'lazy'; f.referrerPolicy = 'no-referrer';
    f.src = `https://dexscreener.com/solana/${encodeURIComponent(t.mint)}?embed=1&loadChartSettings=0&trades=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=usd&interval=1`;
    ch.appendChild(f);
    }
    const links = $('#drLinks'); links.textContent = '';
    const home = { pump: ['pump.fun', `https://pump.fun/coin/${t.mint}`], bonk: ['LetsBonk', `https://letsbonk.fun/token/${t.mint}`], bags: ['Bags', `https://bags.fm/${t.mint}`] }[t.launchpad || 'pump'];
    (home ? [home] : []).concat([['DexScreener', `https://dexscreener.com/solana/${t.mint}`], ['Solscan', `https://solscan.io/token/${t.mint}`], ['Search on X', `https://x.com/search?q=${t.mint}&f=live`]])
      .concat([['X', t.twitter], ['Telegram', t.telegram], ['Website', t.website]].filter(l => safeHref(l[1])))
      .forEach(([lab, href]) => { const a = el('a', '', lab); a.href = safeHref(href) || href; a.target = '_blank'; a.rel = 'noopener noreferrer'; links.appendChild(a); });
  }
}
$('#drMint').addEventListener('click', () => drawerToken && copy(drawerToken.mint));
$$('.tr-tabs button').forEach(b => b.addEventListener('click', () => {
  side = b.dataset.side; $$('.tr-tabs button').forEach(x => x.classList.toggle('on', x === b));
  $$('.tr-body').forEach(p => { p.hidden = p.dataset.pane !== side; });
}));
$('#buyAmts').addEventListener('click', e => { const b = e.target.closest('button'); if (b) $('#buyCustom').value = b.dataset.v; });
$('#buyBtn').addEventListener('click', e => drawerToken && trade('buy', drawerToken, +$('#buyCustom').value, e.currentTarget));
$('#sellAmts').addEventListener('click', e => { const b = e.target.closest('button'); if (b && drawerToken) trade('sell', drawerToken, b.dataset.v, b); });

/* ---------- wallet ---------- */
let wallet = store.get('vv-wallet', null);
if (wallet && (wallet.kind !== 'browser' || !B58RE.test(wallet.addr))) wallet = null; // guest wallets can't trade
let provider = null;
function detect() {
  const out = [];
  if (window.phantom && window.phantom.solana && window.phantom.solana.isPhantom) out.push(['Phantom', window.phantom.solana]);
  if (window.solflare && window.solflare.isSolflare) out.push(['Solflare', window.solflare]);
  if (window.backpack && window.backpack.isBackpack) out.push(['Backpack', window.backpack]);
  if (!out.length && window.solana && typeof window.solana.connect === 'function') out.push(['Solana wallet', window.solana]);
  return out;
}
function renderWallet() {
  const b = $('#walletBtn');
  if (wallet) { b.textContent = ''; const c = el('canvas'); c.width = 7; c.height = 7; drawIdentTo(c, wallet.addr); b.append(c, el('span', '', short(wallet.addr))); b.classList.add('pink'); }
  else { b.textContent = 'Connect wallet'; b.classList.remove('pink'); }
  $('#wList').hidden = !!wallet; $('#wConnected').hidden = !wallet;
  $('#wTitle').textContent = wallet ? 'CONNECTED' : 'CONNECT';
  if (wallet) { $('#wAddr').textContent = short(wallet.addr); $('#wKind').textContent = wallet.wallet || 'Solana wallet'; drawIdentTo($('#wIdent'), wallet.addr); }
  else {
    const list = $('#wList'); list.textContent = ''; const found = detect();
    if (!found.length) list.appendChild(el('p', '', 'No Solana wallet found in this browser. Install a wallet extension such as Phantom, Solflare or Backpack, then reload this page.'));
    found.forEach(([name, p]) => { const o = el('button', 'wopt'); o.type = 'button'; o.append(el('span', '', name), el('small', '', 'Detected')); o.addEventListener('click', () => connectWith(name, p)); list.appendChild(o); });
  }
}
async function connectWith(name, p) {
  $('#wMsg').textContent = 'Check your wallet to approve…';
  try {
    const res = await p.connect(); const pk = (res && res.publicKey) || p.publicKey;
    if (!pk) throw new Error('no key');
    provider = p; wallet = { addr: pk.toString(), kind: 'browser', wallet: name }; store.set('vv-wallet', wallet);
    $('#wMsg').textContent = ''; $('#walletModal').hidden = true; renderWallet(); toast('Wallet connected · ' + short(wallet.addr), 'ok');
  } catch { $('#wMsg').textContent = 'The wallet request was declined.'; }
}
async function ensureProvider() {
  if (provider && provider.publicKey) return provider;
  const found = detect(); const pref = found.find(f => wallet && f[0] === wallet.wallet) || found[0];
  if (!pref) throw new Error('No Solana wallet found in this browser.');
  const res = await pref[1].connect(); const pk = (res && res.publicKey) || pref[1].publicKey;
  if (!pk) throw new Error('The wallet did not share an address.');
  provider = pref[1];
  if (!wallet || wallet.addr !== pk.toString()) { wallet = { addr: pk.toString(), kind: 'browser', wallet: pref[0] }; store.set('vv-wallet', wallet); renderWallet(); }
  return provider;
}
$('#walletBtn').addEventListener('click', () => { $('#wMsg').textContent = ''; renderWallet(); $('#walletModal').hidden = false; });
$('#walletModal').addEventListener('pointerdown', e => { if (e.target.id === 'walletModal') $('#walletModal').hidden = true; });
$('#walletModal [data-close]').addEventListener('click', () => { $('#walletModal').hidden = true; });
$('#wDisconnect').addEventListener('click', async () => { try { provider && provider.disconnect && await provider.disconnect(); } catch {} provider = null; wallet = null; store.set('vv-wallet', null); renderWallet(); toast('Wallet disconnected', 'info'); });
// reconnect silently if the wallet already trusts this site
setTimeout(() => { if (!wallet) return; const f = detect().find(x => x[0] === wallet.wallet); if (f) f[1].connect({ onlyIfTrusted: true }).then(() => { provider = f[1]; }).catch(() => {}); }, 400);
renderWallet();

/* ---------- trading ---------- */
const b64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
function bytesToB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
let busy = false;
async function trade(action, t, amount, btn) {
  const msg = $('#trMsg'); const inDrawer = drawerToken && drawerToken.mint === t.mint && !$('#drawer').hidden;
  const say = (text, cls) => { if (inDrawer) { msg.textContent = text; msg.className = 'tr-msg ' + (cls || ''); } };
  if (busy) return;
  if (action === 'buy' && !(amount > 0 && amount <= 100)) { toast('Enter a buy amount between 0 and 100 SOL.', 'err'); return; }
  if (!wallet) { $('#walletModal').hidden = false; renderWallet(); return; }
  if (!window.solanaWeb3) { toast('The Solana library did not load. Check your connection and reload.', 'err'); return; }
  busy = true; if (btn) btn.disabled = true;
  const label = action === 'buy' ? `Buy ${amount} SOL of ${t.symbol ? '$' + t.symbol : 'this coin'}` : `Sell ${amount} of ${t.symbol ? '$' + t.symbol : 'this coin'}`;
  try {
    const p = await ensureProvider();
    say('Preparing the transaction…');
    const r = await fetch('/api/trade-tx', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey: wallet.addr, action, mint: t.mint, amount, slippage: settings.slip, priorityFee: settings.prio, pool: t.status === 'migrated' ? 'auto' : ({ pump: 'pump', bonk: 'bonk', launchlab: 'launchlab' })[t.launchpad || 'pump'] || 'auto' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'The trade could not be prepared.');
    const tx = window.solanaWeb3.VersionedTransaction.deserialize(b64ToBytes(j.tx));
    say('Approve the trade in your wallet…');
    let sig;
    if (typeof p.signAndSendTransaction === 'function') {
      const res = await p.signAndSendTransaction(tx); sig = (res && res.signature) || res;
    } else {
      const signed = await p.signTransaction(tx);
      const s = await fetch('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx: bytesToB64(signed.serialize()) }) });
      const sj = await s.json().catch(() => ({})); if (!s.ok) throw new Error(sj.error || 'The network refused the transaction.'); sig = sj.signature;
    }
    if (sig && typeof sig !== 'string' && window.solanaWeb3.bs58) sig = window.solanaWeb3.bs58.encode(sig);
    const href = `https://solscan.io/tx/${encodeURIComponent(String(sig))}`;
    toast(`${label}: submitted.`, 'ok', { href, text: 'View on Solscan' });
    if (inDrawer) { msg.textContent = 'Submitted. '; msg.className = 'tr-msg ok'; const a = el('a', '', 'Check it on Solscan'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; msg.appendChild(a); }
  } catch (e) {
    const text = /reject|declin|cancel/i.test(String(e && e.message)) ? 'You cancelled the trade in your wallet.' : (e && e.message) || 'The trade failed.';
    toast(text, 'err'); say(text, 'err');
  } finally { busy = false; if (btn) btn.disabled = false; }
}
})();
