#!/usr/bin/env node
/**
 * levels-relay: read MenthorQ gamma levels straight off TradingView Desktop and
 * turn them into the 38-number strings the "Option Levels" / "Auto-GEX Master
 * Levels" indicator takes, then post them to Discord.
 *
 * Zero dependencies: Node 22+ (built-in fetch + WebSocket).
 *
 *   node levels-relay.mjs selftest             check the parser (no TradingView needed)
 *   node levels-relay.mjs validate [--watch]   check config.json
 *   node levels-relay.mjs tabs                 list the open chart tabs (to pick the levels tab)
 *   node levels-relay.mjs learn [--markets] [--apply]
 *                                              look at MenthorQ on the levels tab and compare it
 *                                              with what we expect (run once during setup)
 *   node levels-relay.mjs check                list the indicators on the levels tab
 *   node levels-relay.mjs status               live? fresh? newer MenthorQ version out? last post?
 *   node levels-relay.mjs dump                 raw MenthorQ labels/lines/tables on the levels tab
 *   node levels-relay.mjs read                 read every market and print the strings (posts nothing)
 *   node levels-relay.mjs post [--force]       read, check, then post to Discord
 *   node levels-relay.mjs watch                stay running; post once per window when fresh levels appear
 *
 * Ground rules (README → "What it will never do"): it never reloads TradingView,
 * never starts or restarts it unless config.json allows it, only switches symbols
 * on the levels tab, never posts stale, incomplete or mismatched levels, and never
 * sends failure notices to the levels channel.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, appendFileSync, realpathSync } from 'node:fs';
import { execSync, execFileSync, spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = '1.2.4';

// ---------------------------------------------------------------- config
const DEFAULTS = {
  port: 9222,
  // The TradingView tab the tool reads from (its layout id; run `tabs`). It
  // switches this tab's symbol while it reads, so it must not be one you trade on.
  layout: '',
  webhook_url: '',
  webhook_name: 'Option Levels',
  // Failure notices go here (a private channel such as #modlog), never to webhook_url.
  modlog_webhook_url: '',
  symbols: {
    NQ: 'CME_MINI:NQ1!',
    ES: 'CME_MINI:ES1!',
    GC: 'COMEX:GC1!',
    OIL: 'NYMEX:CL1!',
    SILVER: 'COMEX:SI1!',
  },
  // Substrings of the indicator names on the chart (case-insensitive).
  studies: { eod: 'MenthorQ Gamma Levels EOD', intraday: 'MenthorQ Gamma Levels Intraday' },
  // Extra spellings for level names, e.g. { "Gamma Flip": "HVL" }. `learn` suggests these.
  aliases: {},
  // "update": post once per window, as soon as fresh levels are on the chart.
  // "schedule": post at schedule_et (still only if the levels are fresh).
  mode: 'update',
  // MenthorQ publishes Intraday levels from 08:00 ET and EOD levels around 19:20
  // and 22:30 ET. A window posts once, when its `wait_for` indicator shows today's date.
  windows: [
    { name: 'morning', from: '07:45', to: '11:30', wait_for: 'intraday', nudge_after: '08:20' },
    { name: 'evening', from: '19:00', to: '23:30', wait_for: 'eod', nudge_after: '19:45' },
  ],
  check_every_minutes: 2,
  schedule_et: ['08:20', '19:45'],
  // Every market needs at least this many of the 19 levels per indicator, or nothing is posted.
  min_levels: 15,
  // Both off by default: opening or restarting TradingView can pull focus or the
  // live session away from you. See README → "Optional: let it manage TradingView".
  start_tradingview: false,
  allow_restart: false,
  notify_desktop: true,
  notify_missed_window: true,
  settle_seconds: 25,
  timeout_seconds: 30,
};

function loadConfig(dir = HERE) {
  const p = join(dir, 'config.json');
  let user = {};
  if (existsSync(p)) {
    try { user = JSON.parse(readFileSync(p, 'utf8')); }
    catch (e) { throw new Error(`config.json isn't valid JSON (${e.message}). Compare it with config.example.json.`); }
  }
  return { ...normalizeConfig(user), dir };
}

function normalizeConfig(user) {
  user = { ...user };
  // settings renamed in 1.2.2
  if ('take_back_session' in user && !('allow_restart' in user)) user.allow_restart = !!user.take_back_session;
  if (Array.isArray(user.update_windows_et) && !user.windows)
    user.windows = user.update_windows_et.map(([from, to]) => from < '15:00'
      ? { name: 'morning', from, to, wait_for: 'intraday' } : { name: 'evening', from, to, wait_for: 'eod' });
  if (user.update_check_minutes && !user.check_every_minutes) user.check_every_minutes = user.update_check_minutes;
  // the example config's "PASTE_..." placeholders mean "not set"
  for (const k of ['webhook_url', 'modlog_webhook_url']) if (typeof user[k] === 'string' && !/^https:\/\//.test(user[k].trim())) user[k] = '';
  const cfg = { ...DEFAULTS, ...user,
    symbols: { ...DEFAULTS.symbols, ...(user.symbols || {}) },
    studies: { ...DEFAULTS.studies, ...(user.studies || {}) },
    aliases: { ...(user.aliases || {}) } };
  for (const [t, s] of Object.entries(cfg.symbols)) if (!s) delete cfg.symbols[t];   // "SILVER": "" turns a market off
  cfg.layout = String(cfg.layout || '').trim().replace(/^.*\/chart\//, '').replace(/[/?#].*$/, '');
  cfg.windows = (cfg.windows || []).map(w => ({ nudge_after: '', days: w.from >= '15:00' ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5], ...w }));
  for (const w of cfg.windows)
    if (!w.name || !/^\d\d:\d\d$/.test(w.from) || !/^\d\d:\d\d$/.test(w.to) || !['eod', 'intraday'].includes(w.wait_for))
      throw new Error(`config.json "windows": each needs a "name", "from"/"to" as "HH:MM" (Eastern) and "wait_for" as "eod" or "intraday". Got ${JSON.stringify(w)}.`);
  return cfg;
}

// ---------------------------------------------------------------- what MenthorQ looks like
// From MenthorQ's TradingView guides and screenshots of a MenthorQ chart (Oct 2026); see docs/MENTHORQ.md.
// `learn` checks a real chart against these and reports anything different.
const MENTHORQ = {
  // "Last Update: 2026-10-13 22:27" (EOD) · "Last Update: 2026-10-14 08:00 EST" (Intraday)
  stamp: /Last Update:?\s*(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})(?:\s*(EST|EDT|ET)\b)?/i,
  // table header and the timestamp box: not level names
  chrome: /^(key levels?|value|distance to spot|end of day levels|intraday levels)$|last update/i,
  noLevels: /no levels for this ticker/i,
  // converted levels carry their source ticker: "Call Resistance (SPX)"
  converted: /(gex|call resistance|put support|hvl|gamma wall|1d m(ax|in)).*\([A-Z][A-Z0-9.!]{0,10}\)/i,
};

// The indicator's fixed order: 19 EOD values, then the same 19 Intraday.
const ORDER = ['GEX 1', 'GEX 2', 'GEX 3', 'GEX 4', 'GEX 5', 'GEX 6', 'GEX 7', 'GEX 8', 'GEX 9', 'GEX 10',
  'CALL RESISTANCE', 'CALL RESISTANCE 0DTE', 'PUT SUPPORT', 'PUT SUPPORT 0DTE',
  'HVL', 'HVL 0DTE', 'GAMMA WALL 0DTE', '1D MAX', '1D MIN'];
const TICKERS = ['NQ', 'ES', 'GC', 'OIL', 'SILVER'];
const LABEL = { eod: 'EOD', intraday: 'Intraday' };

const normName = s => String(s).toUpperCase().replace(/1[\s-]*DAY/g, '1D').replace(/GEX\s*(\d+)/g, 'GEX $1').replace(/\s+/g, ' ').trim();
const splitNames = text => String(text || '').split(/\/|\n|\|/);
const stripPrice = s => s.replace(/[:=]?\s*[-+]?\d[\d,]*\.\d+\s*$|[:=]\s*[-+]?\d[\d,]*\s*$/, '');

function nameOf(part, aliases = {}) {
  const al = Object.fromEntries(Object.entries(aliases).map(([k, v]) => [normName(k), normName(v)]));
  for (const cand of [part, stripPrice(part)]) {
    const n = normName(cand);
    if (ORDER.includes(n)) return n;
    if (ORDER.includes(al[n])) return al[n];
  }
  return null;
}

// "Call Resistance 0DTE / Gamma Wall 0DTE" -> two names. Tolerates newlines,
// extra spaces, "1-Day Max", "GEX10" and a trailing price ("HVL 30,910.00").
function namesIn(text, aliases = {}) {
  return splitNames(text).map(p => nameOf(p, aliases)).filter(Boolean);
}

// Text that looks like a level name we don't know (for `learn`).
function unknownIn(text, aliases = {}) {
  const t = String(text || '').trim();
  if (!t || MENTHORQ.chrome.test(t) || MENTHORQ.stamp.test(t) || MENTHORQ.noLevels.test(t)) return [];
  return splitNames(t).map(s => s.trim())
    .filter(s => s && !/^[-+]?[\d,.]+%?$/.test(s) && !MENTHORQ.chrome.test(s) && !nameOf(s, aliases));
}

function parseStamp(text) {
  const m = String(text || '').match(MENTHORQ.stamp);
  if (!m) return null;
  const time = m[2].padStart(5, '0');
  return { date: m[1], time, text: `${m[1]} ${time}${m[3] ? ' ' + m[3].toUpperCase() : ''}` };
}

const num = s => { const x = parseFloat(String(s).replace(/,/g, '')); return isFinite(x) ? x : null; };

// ---------------------------------------------------------------- talking to TradingView
const sleep = ms => new Promise(r => setTimeout(r, ms));
const POLL_MS = Number(process.env.LEVELS_RELAY_POLL_MS) || 1000;   // the test suite speeds this up
const layoutIdOf = url => (String(url).match(/\/chart\/([^/?#]+)/) || [])[1] || '';

class FrozenError extends Error {
  constructor() { super('TradingView on this computer shows "Session disconnected" (another computer has the live session), so its chart is frozen. Nothing was posted.'); }
}

async function cdpTargets(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!r) throw new Error(`TradingView isn't reachable on port ${port}. Quit TradingView fully, then start it with start-tradingview.`);
  return (await r.json()).filter(t => t.type === 'page' && /tradingview\.com\/chart/.test(t.url || ''));
}

async function openTarget(target, timeoutMs) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const opened = new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('Could not open the debug connection to TradingView.'));
  });
  let openTimer;
  const timer = new Promise((_, rej) => { openTimer = setTimeout(() => rej(new Error("TradingView didn't accept the debug connection within 10s.")), 10000); });
  opened.catch(() => {}); timer.catch(() => {});
  try { await Promise.race([opened, timer]); }
  catch (e) { try { ws.close(); } catch { /* */ } throw e; }
  finally { clearTimeout(openTimer); }
  let id = 0, closed = false;
  const pending = new Map();
  const failAll = msg => { for (const p of pending.values()) p.reject(new Error(msg)); pending.clear(); };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    const p = pending.get(m.id);
    if (p) { pending.delete(m.id); p.resolve(m); }
  };
  ws.onclose = () => { closed = true; failAll('The connection to TradingView closed (did TradingView quit?). Nothing was posted.'); };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error('The connection to TradingView is closed.'));
    const i = ++id;
    const t = setTimeout(() => { pending.delete(i); reject(new Error(`TradingView didn't answer within ${Math.round(timeoutMs / 1000)}s (it may be frozen or busy). Nothing was posted.`)); }, timeoutMs);
    pending.set(i, { resolve: m => { clearTimeout(t); resolve(m); }, reject: e => { clearTimeout(t); reject(e); } });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async expression => {
    const m = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description || 'TradingView reported an error');
    return m.result?.result?.value;
  };
  return { evaluate, target, close: () => { closed = true; failAll('closed'); try { ws.close(); } catch { /* */ } } };
}

// The levels tab: the one named in config.json, or the only tab with MenthorQ on it.
async function connect(cfg) {
  const targets = await cdpTargets(cfg.port);
  if (!targets.length) throw new Error('TradingView has no chart open. Open the levels tab.');
  const ms = cfg.timeout_seconds * 1000;
  if (cfg.layout) {
    const t = targets.find(x => layoutIdOf(x.url) === cfg.layout);
    if (!t) throw new Error(`The levels tab (layout "${cfg.layout}") isn't open in TradingView. Open it, or run "node levels-relay.mjs tabs".`);
    return openTarget(t, ms);
  }
  if (targets.length === 1) return openTarget(targets[0], ms);
  const withMQ = [];
  for (const t of targets) {
    const c = await openTarget(t, ms);
    let has = false;
    try { has = (await c.evaluate(READ_JS([cfg.studies.eod, cfg.studies.intraday]))).studies.length > 0; } catch { /* */ }
    if (has) withMQ.push(c); else c.close();
  }
  if (withMQ.length === 1) return withMQ[0];
  withMQ.forEach(c => c.close());
  throw new Error(withMQ.length
    ? 'More than one tab has MenthorQ on it. Run "node levels-relay.mjs tabs" and put the levels tab\'s id in config.json → "layout".'
    : 'No open tab has the MenthorQ indicators. Open the tab with MenthorQ Gamma Levels EOD and Intraday.');
}

const CHART = 'window.TradingViewApi._activeChartWidgetWV.value()';

// Every matching study with its labels, horizontal lines and table cells,
// plus the chart's symbol, last price and whether the session is frozen.
const READ_JS = (match) => `(function(){
  var match = ${JSON.stringify(match.map(s => s.toLowerCase()))};
  var C = ${CHART}, cw = C._chartWidget, out = [], price = null;
  try { var bar = cw.model().mainSeries().bars().last(); price = bar && bar.value ? bar.value[4] : null; } catch(e) {}
  cw.model().model().dataSources().forEach(function(s){
    if (!s.metaInfo) return;
    var meta = s.metaInfo(); var name = meta.description || meta.shortDescription || '';
    var title = ''; try { title = s.title ? s.title() : ''; } catch(e) {}
    var hay = (name + ' ' + title).toLowerCase();
    if (match.length && !match.some(function(m){ return hay.indexOf(m) >= 0; })) return;
    var g = s._graphics, pc = g && g._primitivesCollection;
    // labels/lines sit one level deeper (.get(false)) than table cells on real TradingView
    function coll(a, b){ var o = []; try { var c = pc[a].get(b);
      if (c && !c._primitivesDataById && c.get) c = c.get(false);
      c._primitivesDataById.forEach(function(v){ o.push(v); }); } catch(e) {} return o; }
    var vis = true; try { vis = s.properties().visible.value(); } catch(e) {}
    var rawCells = coll('dwgtablecells','tableCells');
    out.push({ id: s.id ? s.id() : null, name: name, title: title, visible: vis,
      sid: meta.scriptIdPart || '', version: (meta.pine && meta.pine.version) || '',
      labels: coll('dwglabels','labels').map(function(v){ return { t: v.t || '', y: v.y }; }),
      lines: coll('dwglines','lines').filter(function(v){ return v.y1 === v.y2; }).map(function(v){ return v.y1; }),
      cells: rawCells.map(function(v){ return { t: v.t || '', r: v.row, c: v.col, tid: v.tid || 0 }; }),
      cellKeys: rawCells.length ? Object.keys(rawCells[0]) : [] });
  });
  var txt = (document.body && document.body.innerText) || '';
  var lid = '', lname = '';
  try { lid = window.TradingViewApi.layoutId() || ''; } catch(e) {}
  try { lname = window.TradingViewApi.layoutName() || ''; } catch(e) {}
  return { symbol: C.symbol(), price: price, frozen: txt.indexOf('Session disconnected') >= 0,
    layoutId: lid, layoutName: lname, hidden: document.visibilityState === 'hidden', studies: out };
})()`;

const SET_VISIBLE_JS = (ids, on) => `(function(){ var c = ${CHART}; var n = 0;
  ${JSON.stringify(ids)}.forEach(function(id){ try { var s = c.getStudyById(id);
    s.setVisible ? s.setVisible(${on}) : s.properties().visible.setValue(${on}); n++; } catch(e) {} }); return n; })()`;

// Asks TradingView (the same way its own app does) for the newest published version of each script.
const VERSIONS_JS = sids => `(async function(){ var out = {}, sids = ${JSON.stringify(sids)};
  for (var i = 0; i < sids.length; i++) { try {
    // no-store + a unique URL: the browser caches this answer, which hid new versions in testing
    var r = await fetch('https://pine-facade.tradingview.com/pine-facade/versions/' + encodeURIComponent(sids[i]) + '/last?t=' + Date.now(), { credentials: 'include', cache: 'no-store' });
    if (r.ok) { var j = await r.json(); var v = Array.isArray(j) ? j[j.length - 1] : j; out[sids[i]] = { version: v && v.version, created: v && v.created }; }
  } catch (e) {} }
  return out; })()`;

const mqMatch = cfg => ['menthorq', cfg.studies.eod, cfg.studies.intraday];
const symbolRoot = s => String(s || '').split(':').pop();

async function setSymbol(cdp, sym) {
  await cdp.evaluate(`(function(){ ${CHART}.setSymbol(${JSON.stringify(sym)}, {}); return true; })()`);
  for (let i = 0; i < 40; i++) {
    await sleep(POLL_MS / 2);
    if (symbolRoot(await cdp.evaluate(`${CHART}.symbol()`)) === symbolRoot(sym)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- parsing
// 1) The "Key Levels" table (Key Level | Value | Distance to Spot) gives exact values.
function fromTable(cells, aliases = {}) {
  const rows = new Map();
  for (const c of cells || []) {
    // skip the header row and the timestamp box so their cells can't collide with level rows
    if (MENTHORQ.chrome.test(String(c.t).trim()) || MENTHORQ.stamp.test(c.t)) continue;
    const k = `${c.tid}:${c.r}`;
    if (!rows.has(k)) rows.set(k, {});
    rows.get(k)[c.c] = c.t;
  }
  const out = {};
  for (const row of rows.values()) {
    const cols = Object.keys(row).map(Number).sort((a, b) => a - b);
    if (cols.length < 2) continue;
    const names = namesIn(row[cols[0]], aliases);
    const value = num(row[cols[1]]);
    if (names.length && value) for (const n of names) out[n] = value;
  }
  return out;
}

// 2) The labels drawn on the chart (each sits on its level's line).
function fromLabels(labels, lines, aliases = {}) {
  const out = {};
  for (const lab of labels || []) {
    const names = namesIn(lab.t, aliases);
    if (!names.length) continue;
    let price = lab.y;
    if (lines?.length && price != null) {   // snap to the nearest drawn line when slightly off
      const near = lines.reduce((a, b) => Math.abs(b - price) < Math.abs(a - price) ? b : a);
      if (Math.abs(near - price) / price < 0.0005) price = near;
    }
    if (price == null || !isFinite(price) || price <= 0) continue;
    for (const n of names) out[n] = price;
  }
  return out;
}

function parseSession(study, aliases = {}) {
  const table = fromTable(study.cells, aliases);
  const labels = fromLabels(study.labels, study.lines, aliases);
  const useTable = Object.keys(table).length >= 5;
  const found = useTable ? table : { ...labels, ...table };
  const texts = (study.cells || []).map(c => c.t).concat((study.labels || []).map(l => l.t));
  // the table and the chart lines are two views of the same levels: they must agree
  const both = Object.keys(table).filter(n => n in labels);
  const disagree = both.filter(n => Math.abs(table[n] - labels[n]) / table[n] > 0.003);
  return {
    values: ORDER.map(n => found[n] || 0),
    found: Object.keys(found).length,
    source: useTable ? 'table' : 'labels',
    stamp: texts.map(parseStamp).find(Boolean) || null,
    noLevels: texts.some(t => MENTHORQ.noLevels.test(t)),
    converted: texts.some(t => MENTHORQ.converted.test(t)),
    unknown: [...new Set(texts.flatMap(t => unknownIn(t, aliases)))],
    crossChecked: both.length,
    disagree,
  };
}

const EMPTY = { values: new Array(19).fill(0), found: 0, source: '-', stamp: null, noLevels: false, converted: false, unknown: [], crossChecked: 0, disagree: [] };
// What the levels are, ignoring "Distance to Spot" (that column changes with every tick).
const snapKey = snap => JSON.stringify(snap.studies.map(s => [s.labels.map(l => `${l.t}@${l.y}`), s.cells.filter(c => c.c <= 1).map(c => c.t)]));
const pickStudy = (snap, cfg, k) => snap.studies.find(s => `${s.name} ${s.title}`.toLowerCase().includes(cfg.studies[k].toLowerCase()));

async function readStable(cdp, match, settleMs, prevKey) {
  // After a symbol change the indicator recalculates; until then it can still show
  // the previous market's drawings. Wait until the output differs from what was
  // there before the switch (prevKey) and then stops changing.
  let last = '', stableFor = 0, snap = null, key = '';
  const t0 = Date.now();
  while (Date.now() - t0 < settleMs) {
    snap = await cdp.evaluate(READ_JS(match));
    if (snap.frozen) throw new FrozenError();
    key = snapKey(snap);
    const ok = snap.studies.some(s => s.labels.length || s.cells.length) && key !== prevKey;
    stableFor = (ok && key === last) ? stableFor + 1 : 0;
    last = key;
    if (stableFor >= 2) return { snap, key, settled: true };
    await sleep(POLL_MS);
  }
  return { snap, key, settled: false };
}

const fmt = v => v.map(x => (x ? +(+x).toFixed(4) : 0)).join(',');

async function readAll(cfg, log = console.log) {
  const cdp = await connect(cfg);
  const match = [cfg.studies.eod, cfg.studies.intraday];
  try {
    const start = await cdp.evaluate(READ_JS(match));
    if (start.frozen) throw new FrozenError();
    if (!start.studies.length)
      throw new Error(`No MenthorQ indicator on the levels tab (looking for "${cfg.studies.eod}" / "${cfg.studies.intraday}"). Run "node levels-relay.mjs learn".`);
    const originalSymbol = start.symbol;
    const hidden = start.studies.filter(s => !s.visible).map(s => s.id).filter(Boolean);
    // Hidden indicators don't calculate, so show them for the read and hide them again after.
    if (hidden.length) await cdp.evaluate(SET_VISIBLE_JS(hidden, true));
    const results = {};
    let prevKey = snapKey(start), onRoot = symbolRoot(start.symbol);
    try {
      for (const t of TICKERS) {
        const sym = cfg.symbols[t];
        if (!sym) continue;
        log(`  reading ${t} (${sym})...`);
        const moving = symbolRoot(sym) !== onRoot;
        if (moving && !(await setSymbol(cdp, sym))) { results[t] = { symbol: sym, error: "the chart didn't switch to it" }; continue; }
        onRoot = symbolRoot(sym);
        const { snap, key, settled } = await readStable(cdp, match, cfg.settle_seconds * 1000, moving ? prevKey : null);
        prevKey = key;
        const eod = pickStudy(snap, cfg, 'eod'), intra = pickStudy(snap, cfg, 'intraday');
        const e = eod ? parseSession(eod, cfg.aliases) : EMPTY;
        const i = intra ? parseSession(intra, cfg.aliases) : EMPTY;
        const values = e.values.concat(i.values);
        const { values: _e, ...eSum } = e, { values: _i, ...iSum } = i;
        results[t] = { symbol: sym, string: fmt(values), values, price: snap.price, settled, eod: eSum, intraday: iSum };
      }
    } finally {
      const back = await setSymbol(cdp, originalSymbol).catch(() => false);
      if (!back) log(`  ⚠️  couldn't switch the levels tab back to ${originalSymbol}`);
      if (hidden.length) await cdp.evaluate(SET_VISIBLE_JS(hidden, false)).catch(() => {});
    }
    return results;
  } finally { cdp.close(); }
}

// ---------------------------------------------------------------- checks before posting
// Everything that has to be true before levels go to the channel. `rule` adds the
// freshness check ({ wait_for: 'eod'|'intraday', date: 'YYYY-MM-DD' }).
function problemsWith(results, cfg, rule = null) {
  const out = [], seen = new Map();
  for (const t of TICKERS) {
    if (!cfg.symbols[t]) continue;
    const r = results[t];
    if (!r) { out.push(`${t}: not read`); continue; }
    if (r.error) { out.push(`${t}: ${r.error}`); continue; }
    if (r.eod.noLevels || r.intraday.noLevels) { out.push(`${t}: MenthorQ shows "No Levels for this Ticker" (if MenthorQ doesn't cover ${t}, set "${t}": "" under "symbols" in config.json)`); continue; }
    if (!r.settled) { out.push(`${t}: the indicator didn't finish loading`); continue; }
    if (r.eod.found < cfg.min_levels || r.intraday.found < cfg.min_levels)
      out.push(`${t}: only ${r.eod.found}/19 EOD and ${r.intraday.found}/19 Intraday levels found`);
    const lv = r.values.filter(Boolean).sort((a, b) => a - b);
    const med = lv.length ? lv[Math.floor(lv.length / 2)] : 0;
    if (r.price && med && Math.abs(med - r.price) / r.price > 0.25)
      out.push(`${t}: the levels (around ${med}) don't fit the chart price (${r.price}); they may belong to another market`);
    for (const k of ['eod', 'intraday'])
      if (r[k].disagree.length > Math.max(2, r[k].crossChecked * 0.2))
        out.push(`${t}: the ${LABEL[k]} table and the chart lines disagree (${r[k].disagree.join(', ')})`);
    if (seen.has(r.string)) out.push(`${t}: same numbers as ${seen.get(r.string)}; one of them is another market's levels`);
    seen.set(r.string, t);
    if (rule) {
      const s = r[rule.wait_for].stamp;
      if (!s) out.push(`${t}: the ${LABEL[rule.wait_for]} indicator shows no "Last Update" time (turn on "Show Timestamp" in its settings)`);
      else if (s.date < rule.date) out.push(`${t}: the ${LABEL[rule.wait_for]} levels are from ${s.text}, not today's (${rule.date}). In TradingView, click the purple ⟳ next to the indicator name to load the new version`);
    }
  }
  const dates = new Set(TICKERS.filter(t => results[t]?.eod?.stamp).map(t => results[t].eod.stamp.date));
  if (dates.size > 1) out.push(`the markets show different EOD update dates (${[...dates].join(', ')})`);
  return out;
}

const stampsText = stamps => `EOD ${stamps.eod?.text || '?'} · Intraday ${stamps.intraday?.text || '?'}`;
const stampsOf = results => {
  const first = Object.values(results).find(r => r && r.eod) || {};
  return stampsText({ eod: first.eod?.stamp, intraday: first.intraday?.stamp });
};

// ---------------------------------------------------------------- output
const nowET = () => new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function render(results) {
  const parts = [`📊 **MenthorQ option levels** · ${nowET()} ET\nLast update: ${stampsOf(results)}\n` +
                 'Paste each line into the matching box of the Option Levels / Auto-GEX indicator.'];
  for (const t of TICKERS) {
    const r = results[t];
    if (!r || r.error) continue;
    parts.push(`**${t}**\n\`\`\`\n${r.string}\n\`\`\``);
  }
  return parts;
}

const WEBHOOK_RE = /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//;
function requireWebhook(cfg) {
  if (!cfg.webhook_url || !WEBHOOK_RE.test(cfg.webhook_url))
    throw new Error('config.json needs a Discord webhook URL in "webhook_url" (Channel settings → Integrations → Webhooks → Copy Webhook URL). An invite link (discord.gg/...) won\'t work.');
  if (cfg.modlog_webhook_url && !WEBHOOK_RE.test(cfg.modlog_webhook_url))
    throw new Error('"modlog_webhook_url" in config.json isn\'t a Discord webhook URL. Fix it, or set it to "" to skip failure notices.');
}
function requireLayout(cfg) {
  if (!cfg.layout)
    throw new Error('Automatic posting needs a levels tab: set "layout" in config.json to a TradingView tab you don\'t trade on (run "node levels-relay.mjs tabs"). The tool switches that tab\'s symbol while it reads.');
}

async function postWebhook(cfg, parts) {
  requireWebhook(cfg);
  const chunks = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + '\n' + p).length > 1900 && cur) { chunks.push(cur); cur = ''; }
    cur = cur ? cur + '\n' + p : p;
  }
  if (cur) chunks.push(cur);
  for (const c of chunks) {
    const r = await fetch(cfg.webhook_url + '?wait=true', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cfg.webhook_name, content: c, allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Discord said ${r.status}: ${(await r.text()).slice(0, 200)}`);
    await sleep(600);
  }
}

function save(cfg, results, problems) {
  const dir = join(cfg.dir, 'output');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  writeFileSync(join(dir, `levels-${stamp}.json`), JSON.stringify({ problems, results }, null, 2));
  if (!problems.length) writeFileSync(join(dir, 'latest.txt'), render(results).join('\n\n').replace(/\*\*|`{3}|_/g, '') + '\n');
}

function loadState(cfg) {
  try { return JSON.parse(readFileSync(join(cfg.dir, 'output', 'state.json'), 'utf8')); } catch { return null; }
}
function saveState(cfg, st) {
  const dir = join(cfg.dir, 'output');
  mkdirSync(dir, { recursive: true });
  const cutoff = etParts(new Date(Date.now() - 8 * 864e5)).date;
  for (const k of Object.keys(st.windows || {})) if (k.slice(0, 10) < cutoff) delete st.windows[k];
  writeFileSync(join(dir, 'state.json.tmp'), JSON.stringify(st, null, 2));
  renameSync(join(dir, 'state.json.tmp'), join(dir, 'state.json'));
}

// Notices for whoever runs the relay: #modlog (never the levels channel) and output/failures.log.
async function report(cfg, message, { notice = false } = {}) {
  const line = `[${nowET()} ET] ${notice ? 'note' : 'problem'}: ${message}`;
  try { mkdirSync(join(cfg.dir, 'output'), { recursive: true }); appendFileSync(join(cfg.dir, 'output', 'failures.log'), line + '\n'); } catch { /* */ }
  const url = cfg.modlog_webhook_url;
  if (!url || url === cfg.webhook_url) return;
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ username: cfg.webhook_name, content: `${notice ? 'ℹ️' : '⚠️'} levels-relay: ${message}`.slice(0, 1900), allowed_mentions: { parse: [] } }) });
  } catch { /* nothing else we can do */ }
}

// ---------------------------------------------------------------- time
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function etParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d).map(x => [x.type, x.value]));
  return { ms: d.getTime(), date: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, dow: DAYS.indexOf(p.weekday) };
}
const activeWindow = (cfg, et) => cfg.windows.find(w => w.days.includes(et.dow) && w.from <= et.hhmm && et.hhmm <= w.to);

// Which indicator has to show today's date before a post counts as fresh: the
// latest window that has started today, or (before the first one) last night's.
function freshnessRule(cfg, et) {
  const latest = (day, before) => cfg.windows.filter(w => w.days.includes(day) && (!before || w.from <= before))
    .sort((a, b) => (a.from < b.from ? 1 : -1))[0];
  const w = latest(et.dow, et.hhmm);
  if (w) return { wait_for: w.wait_for, date: et.date, window: w.name };
  const y = etParts(new Date(et.ms - 864e5));
  const yw = latest(y.dow, null);
  return yw ? { wait_for: yw.wait_for, date: y.date, window: yw.name } : null;
}

// ---------------------------------------------------------------- TradingView the app
// Only used when config.json allows it (start_tradingview / allow_restart).
const IS_WIN = process.platform === 'win32';

function tvRunning() {
  try {
    if (IS_WIN) return /TradingView\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq TradingView.exe"', { encoding: 'utf8' }));
    return execSync('pgrep -x TradingView || true', { encoding: 'utf8' }).trim().length > 0;
  } catch { return false; }
}

function tvLaunch(port) {
  const arg = `--remote-debugging-port=${Number(port) || 9222}`;
  if (IS_WIN) {
    const ps = `$p = Get-AppxPackage TradingView.Desktop; if ($p) { Start-Process (Join-Path $p.InstallLocation 'TradingView.exe') -ArgumentList '${arg}' } ` +
               `elseif (Test-Path "$env:LOCALAPPDATA\\Programs\\TradingView\\TradingView.exe") { Start-Process "$env:LOCALAPPDATA\\Programs\\TradingView\\TradingView.exe" -ArgumentList '${arg}' }`;
    spawn('powershell', ['-NoProfile', '-Command', ps], { detached: true, stdio: 'ignore' }).unref();
  } else {
    // -g: open in the background so it doesn't take focus from what you're doing
    spawn('open', ['-g', '-a', 'TradingView', '--args', arg], { detached: true, stdio: 'ignore' }).unref();
  }
}

function tvQuit() {
  try {
    if (IS_WIN) execSync('taskkill /IM TradingView.exe /T /F', { stdio: 'ignore' });
    else execSync('osascript -e \'quit app "TradingView"\'', { stdio: 'ignore', timeout: 10000 });
  } catch { /* already closed */ }
}

function notifyDesktop(cfg, msg) {
  if (!cfg.notify_desktop) return;
  try {
    if (process.platform === 'darwin')
      execFileSync('osascript', ['-e', `display notification ${JSON.stringify(msg)} with title "levels-relay"`], { stdio: 'ignore', timeout: 5000 });
    else if (IS_WIN)
      spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
        "Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(10000, 'levels-relay', $env:LR_MSG, 'Info'); Start-Sleep 11; $n.Dispose()"],
        { env: { ...process.env, LR_MSG: msg }, detached: true, stdio: 'ignore' }).unref();
  } catch { /* notifications are a nice-to-have */ }
}

// Swappable for tests.
const sys = { running: tvRunning, launch: tvLaunch, quit: tvQuit, notify: notifyDesktop, now: () => new Date() };

async function waitForChart(cfg, seconds = 120) {
  for (let i = 0; i < seconds / 3; i++) {
    try { if ((await cdpTargets(cfg.port)).length) { await sleep(15000); return true; } } catch { /* not up yet */ }
    await sleep(3000);
  }
  return false;
}

// A read-only look at the levels tab: no symbol switching, nothing shown or hidden.
// With versions: true it also asks TradingView for the newest published MenthorQ versions.
async function look(cfg, { versions: wantVersions = false } = {}) {
  let targets;
  try { targets = await cdpTargets(cfg.port); } catch { return { state: sys.running() ? 'no-port' : 'closed' }; }
  if (!targets.length) return { state: 'no-chart' };
  if (cfg.layout && !targets.some(t => layoutIdOf(t.url) === cfg.layout)) return { state: 'no-tab' };
  let cdp;
  try {
    cdp = await connect(cfg);
    const snap = await cdp.evaluate(READ_JS([cfg.studies.eod, cfg.studies.intraday]));
    if (snap.frozen) return { state: 'frozen', snap };
    const eod = pickStudy(snap, cfg, 'eod'), intra = pickStudy(snap, cfg, 'intraday');
    if (!eod || !intra) return { state: 'no-menthorq', snap };
    const stamps = { eod: parseSession(eod, cfg.aliases).stamp, intraday: parseSession(intra, cfg.aliases).stamp };
    let versions = null;
    if (wantVersions) try {
      const v = await cdp.evaluate(VERSIONS_JS([eod.sid, intra.sid].filter(Boolean)));
      const one = s => s && v[s.sid] ? { chart: s.version, latest: v[s.sid].version, published: v[s.sid].created,
        newer: num(v[s.sid].version) > num(s.version) } : null;
      versions = { eod: one(eod), intraday: one(intra) };
    } catch { /* version lookup is best-effort */ }
    return { state: 'live', snap, stamps, versions, hiddenStudies: [eod, intra].filter(s => !s.visible).map(s => s.name) };
  } catch (e) {
    return { state: 'error', error: e.message };
  } finally { cdp?.close(); }
}

const STATE_TEXT = {
  closed: 'closed', 'no-port': 'open without the debug port (quit it and use start-tradingview)', 'no-chart': 'open without a chart',
  'no-tab': 'missing the levels tab', frozen: 'disconnected ("Session disconnected")', 'no-menthorq': 'missing the MenthorQ indicators on the levels tab',
  error: 'not answering',
};

// Only acts if config.json allows it. Returns true if it did something.
async function manageTradingView(cfg, state, log) {
  if (state === 'closed' && cfg.start_tradingview) {
    log('  TradingView is closed: starting it in the background');
    sys.launch(cfg.port);
    return waitForChart(cfg);
  }
  if ((state === 'no-port' || state === 'frozen') && cfg.allow_restart) {
    log(state === 'frozen' ? '  chart is frozen: restarting TradingView to take the session back' : '  TradingView has no debug port: restarting it');
    sys.quit();
    for (let i = 0; i < 20 && sys.running(); i++) await sleep(1000);   // a normal quit can take a few seconds
    if (sys.running()) throw new Error("TradingView didn't quit within 20 seconds, so it wasn't restarted.");
    sys.launch(cfg.port);
    return waitForChart(cfg);
  }
  return false;
}

// ---------------------------------------------------------------- posting
class RefusedError extends Error {
  constructor(problems) { super(`nothing posted: ${problems.join('; ')}`); this.problems = problems; }
}

async function postLevels(cfg, { rule = null, force = false, state = null, log = console.log } = {}) {
  requireWebhook(cfg);
  const results = await readAll(cfg, log);
  const problems = problemsWith(results, cfg, force ? null : rule);
  const stamps = stampsOf(results);
  if (!force && state?.last_posted?.stamps === stamps) problems.push(`these exact levels were already posted (${state.last_posted.at})`);
  save(cfg, results, problems);
  if (problems.length) throw new RefusedError(problems);
  await postWebhook(cfg, render(results));
  return { results, stamps };
}

function missedText(w, ws) {
  const why = ws.lastError ? `last error: ${ws.lastError}`
    : ws.lastState && ws.lastState !== 'live' ? `TradingView on the relay computer was ${STATE_TEXT[ws.lastState] || ws.lastState}`
    : ws.noStamp ? `the ${LABEL[w.wait_for]} indicator shows no "Last Update" time (turn on "Show Timestamp")`
    : `the ${LABEL[w.wait_for]} levels on the chart never showed today's date (last seen: ${ws.lastStamps || 'nothing'}). ` +
      'TradingView only loads new MenthorQ levels after someone clicks the purple ⟳ update icon on the indicator';
  return `no ${w.name} levels were posted (${w.from}–${w.to} ET): ${why}.`;
}

// One pass of the watcher. Read-only unless fresh levels are waiting to be posted.
async function watchTick(cfg, st, log = console.log) {
  const et = etParts(sys.now());
  st.windows ||= {};
  for (const w of cfg.windows) {               // windows that ended today without a post
    if (!w.days.includes(et.dow) || et.hhmm <= w.to) continue;
    const ws = st.windows[`${et.date} ${w.name}`];
    if (ws?.seen && !ws.posted && !ws.missedSent) {
      ws.missedSent = true;
      if (cfg.notify_missed_window) await report(cfg, missedText(w, ws), { notice: true });
    }
  }
  const w = activeWindow(cfg, et);
  if (!w) return st;
  const key = `${et.date} ${w.name}`;
  const ws = (st.windows[key] ||= {});
  ws.seen = true;
  if (ws.posted || ws.gaveUp || (ws.retryAt && et.ms < ws.retryAt)) return st;

  let seen = await look(cfg);
  if (seen.state !== 'live') {
    try { if (await manageTradingView(cfg, seen.state, log)) seen = await look(cfg); }
    catch (e) { log(`  ${e.message}`); }
  }
  ws.lastState = seen.state;
  if (seen.state !== 'live') return st;        // closed, frozen or busy: stay quiet, try again later
  const s = seen.stamps[w.wait_for];
  ws.lastStamps = stampsText(seen.stamps);
  if (!s) { ws.noStamp = true; return st; }
  if (s.date < et.date) {                      // today's levels aren't on the chart yet
    if (!w.nudge_after || et.hhmm < w.nudge_after || ws.nudged) return st;
    const v = (await look(cfg, { versions: true })).versions?.[w.wait_for];
    if (v?.newer) {
      ws.nudged = true;
      log(`  newer MenthorQ ${LABEL[w.wait_for]} version is out (${v.chart} → ${v.latest}); asking for the update click`);
      sys.notify(cfg, `New MenthorQ ${LABEL[w.wait_for]} levels are out. In TradingView's levels tab, click the purple ⟳ next to the indicator name; the relay posts them right after.`);
    }
    return st;
  }
  if (st.last_posted?.stamps === ws.lastStamps) { ws.posted = true; return st; }   // already posted (e.g. by hand)

  log(`[${et.hhmm} ET] fresh ${LABEL[w.wait_for]} levels (${s.text}): posting`);
  try {
    const { stamps } = await postLevels(cfg, { rule: { wait_for: w.wait_for, date: et.date }, state: st, log });
    ws.posted = true;
    st.last_posted = { stamps, at: `${et.date} ${et.hhmm} ET`, window: key };
    log('  posted.');
    sys.notify(cfg, 'Levels posted to Discord ✅');
  } catch (e) {
    ws.attempts = (ws.attempts || 0) + 1;
    ws.retryAt = et.ms + Math.min(30, 5 * 2 ** (ws.attempts - 1)) * 60000;   // 5, 10, 20, 30 min
    log(`  ${e.message}`);
    if (e.message !== ws.lastError) { ws.lastError = e.message; await report(cfg, `couldn't post the ${w.name} levels: ${e.message}`); }
    if (ws.attempts >= 4) {
      ws.gaveUp = true;
      await report(cfg, `stopped trying the ${w.name} levels after 4 attempts. Once it's fixed, run "node levels-relay.mjs post" (or run.command / run.bat).`);
    }
  }
  return st;
}

// ---------------------------------------------------------------- commands
async function cmdTabs(cfg) {
  const targets = await cdpTargets(cfg.port);
  if (!targets.length) { console.log('TradingView is running, but no chart tab is open.'); return; }
  console.log('Open chart tabs:');
  for (const t of targets) {
    const id = layoutIdOf(t.url);
    let c;
    try {
      c = await openTarget(t, cfg.timeout_seconds * 1000);
      const s = await c.evaluate(READ_JS(mqMatch(cfg)));
      console.log(`  ${id === cfg.layout ? '→' : ' '} ${id.padEnd(10)} "${s.layoutName || 'unnamed'}" · ${s.symbol} · MenthorQ indicators: ${s.studies.length}${s.frozen ? ' · FROZEN' : ''}`);
    } catch (e) { console.log(`    ${id.padEnd(10)} (couldn't read it: ${e.message})`); }
    finally { c?.close(); }
  }
  console.log(cfg.layout ? `\nconfig.json → "layout": "${cfg.layout}" (marked →).`
    : '\nPut the levels tab\'s id in config.json → "layout". Pick a tab you don\'t trade on: the tool switches its symbol while it reads.');
}

async function cmdLearn(cfg, flags) {
  console.log(`levels-relay ${VERSION}: checking how MenthorQ looks on this computer\n`);
  const issues = [], suggest = {};
  const say = (good, text, fix) => { console.log(`${good ? '✅' : '⚠️ '} ${text}${!good && fix ? `\n     → ${fix}` : ''}`); if (!good) issues.push(text); };
  const info = text => console.log(`ℹ️  ${text}`);

  // 1. the levels tab
  const targets = await cdpTargets(cfg.port);
  let target = null;
  if (cfg.layout) {
    target = targets.find(t => layoutIdOf(t.url) === cfg.layout);
    if (!target) throw new Error(`The levels tab (layout "${cfg.layout}") isn't open. Open it, or run "tabs".`);
  } else {
    const withMQ = [];
    for (const t of targets) {
      const c = await openTarget(t, cfg.timeout_seconds * 1000);
      try { if ((await c.evaluate(READ_JS(mqMatch(cfg)))).studies.length) withMQ.push(t); } catch { /* */ } finally { c.close(); }
    }
    if (withMQ.length !== 1) throw new Error(withMQ.length ? 'More than one tab has MenthorQ on it. Run "tabs" and set "layout" in config.json first.'
      : 'No open tab has a MenthorQ indicator. Open the tab with MenthorQ Gamma Levels EOD + Intraday and run learn again.');
    target = withMQ[0];
    suggest.layout = layoutIdOf(target.url);
  }
  const cdp = await openTarget(target, cfg.timeout_seconds * 1000);
  let snap;
  try { snap = await cdp.evaluate(READ_JS(mqMatch(cfg))); } finally { cdp.close(); }
  const tabId = layoutIdOf(target.url);
  if (!tabId) { say(false, 'This tab\'s layout has never been saved, so it has no id yet.', 'In TradingView, save the layout with a name (e.g. "levels-relay"), then run learn again.'); return; }
  info(`Levels tab: ${tabId} "${snap.layoutName || 'unnamed'}" on ${snap.symbol}${cfg.layout ? '' : ' (not set in config.json yet)'}`);
  if (snap.frozen) { say(false, 'This TradingView shows "Session disconnected".', 'Click Connect in TradingView and run learn again.'); return; }

  // 2. the two indicators
  const has = (s, k) => `${s.name} ${s.title}`.toLowerCase().includes(cfg.studies[k].toLowerCase());
  const eod = snap.studies.find(s => has(s, 'eod')) || snap.studies.find(s => /end of day|\beod\b/i.test(`${s.name} ${s.title}`));
  const intra = snap.studies.find(s => has(s, 'intraday')) || snap.studies.find(s => /intraday/i.test(`${s.name} ${s.title}`));
  say(!!eod, `EOD indicator: ${eod ? `"${eod.name}"` : 'not found'}`, 'Add "MenthorQ Gamma Levels EOD" (Indicators → Invite-only scripts) to this tab.');
  say(!!intra, `Intraday indicator: ${intra ? `"${intra.name}"` : 'not found'}`, 'Add "MenthorQ Gamma Levels Intraday" to this tab.');
  for (const [k, s] of [['eod', eod], ['intraday', intra]]) {
    if (!s) continue;
    if (!`${s.name} ${s.title}`.toLowerCase().includes(cfg.studies[k].toLowerCase())) {
      suggest.studies = { ...(suggest.studies || cfg.studies), [k]: s.name };
      say(false, `config.json "studies.${k}" ("${cfg.studies[k]}") doesn't match "${s.name}"`, `Set "studies": { "${k}": "${s.name}" } (or run learn --apply).`);
    }
    say(s.visible, `${LABEL[k]} indicator is ${s.visible ? 'visible' : 'hidden'}`, 'Show it (eye icon in the chart legend). Hidden indicators don\'t calculate, so the watcher can\'t see their "Last Update" time.');
  }

  // 3. what each one draws, compared with MenthorQ's docs and real screenshots
  const profile = { at: new Date().toISOString(), version: VERSION, layout: tabId, symbol: snap.symbol, studies: {} };
  for (const [k, s] of [['eod', eod], ['intraday', intra]]) {
    if (!s) continue;
    const p = parseSession(s, cfg.aliases);
    profile.studies[k] = { name: s.name, sid: s.sid, chart_version: s.version, found: p.found, source: p.source, stamp: p.stamp?.text || null,
      unknown: p.unknown, converted: p.converted, labels: s.labels.length, cells: s.cells.length, cell_fields: s.cellKeys };
    const L = LABEL[k];
    if (!s.visible) { info(`${L}: hidden, so what it draws can't be checked yet. Show it and run learn again.`); continue; }
    if (p.noLevels) { say(false, `${L}: MenthorQ shows "No Levels for this Ticker" on ${snap.symbol}`, 'Switch this tab to NQ1! and run learn again.'); continue; }
    say(!!p.stamp, `${L}: "Last Update" time ${p.stamp ? `found (${p.stamp.text}), same format as expected` : 'not found'}`,
      'In the indicator\'s settings, turn on "Show Timestamp". The watcher uses it to know when new levels are on the chart.');
    say(p.source === 'table', `${L}: "Key Levels" table ${p.source === 'table' ? 'found' : 'not found, reading the labels instead'}`,
      'In the indicator\'s settings, set the table text size to anything but "None". The table gives exact values.');
    say(p.found >= cfg.min_levels, `${L}: ${p.found}/19 level names recognized`, p.unknown.length
      ? `Unknown names: ${p.unknown.map(u => `"${u}"`).join(', ')}. If "Short Name" is on in the indicator settings, turn it off; otherwise add them under "aliases" in config.json.`
      : 'Run "node levels-relay.mjs dump" and look at the label text.');
    if (p.crossChecked) say(p.disagree.length === 0, `${L}: table and chart lines agree (${p.crossChecked} levels compared)`, `These differ: ${p.disagree.join(', ')}`);
    if (p.converted) say(false, `${L}: some levels are converted from another ticker (e.g. "(SPX)")`, 'Turn off "Levels Conversion" on this tab so only native futures levels are shown.');
    if (p.unknown.length && p.found >= cfg.min_levels) info(`${L}: other text on the chart (ignored): ${p.unknown.slice(0, 6).map(u => `"${u}"`).join(', ')}`);
  }

  // 4. versions: TradingView only loads new MenthorQ levels after the update click
  const seen = await look({ ...cfg, layout: tabId, studies: { eod: eod?.name || cfg.studies.eod, intraday: intra?.name || cfg.studies.intraday } }, { versions: true });
  for (const k of ['eod', 'intraday']) {
    const v = seen.versions?.[k];
    if (!v) { info(`${LABEL[k]}: couldn't ask TradingView for the newest version (fine; the watcher just won't send "update" reminders).`); continue; }
    profile.studies[k] && (profile.studies[k].latest_version = v.latest);
    say(!v.newer, `${LABEL[k]}: chart has version ${v.chart}, newest published is ${v.latest}`,
      'Click the purple ⟳ next to the indicator name in the legend to load the newest levels.');
  }
  info(snap.hidden ? 'This tab was in the background during the check, and reading still worked.'
    : 'This tab is in front right now. To confirm reads work while it\'s in the background, switch to another tab and run learn again.');
  const rule = freshnessRule(cfg, etParts(sys.now()));
  if (rule && seen.stamps) {
    const s = seen.stamps[rule.wait_for];
    info(`Right now a post needs ${LABEL[rule.wait_for]} levels from ${rule.date}; the chart has ${s ? s.text : 'no time'}${s && s.date >= rule.date ? ' (fresh)' : ''}.`);
  }

  // 5. optional: every market
  if (flags.markets) {
    console.log('\nReading every market on this tab (about a minute)...');
    const results = await readAll({ ...cfg, layout: tabId, studies: { eod: eod?.name || cfg.studies.eod, intraday: intra?.name || cfg.studies.intraday } }, () => {});
    const problems = problemsWith(results, cfg);
    profile.markets = Object.fromEntries(Object.entries(results).map(([t, r]) => [t, r.error ? { error: r.error }
      : { eod_found: r.eod.found, intraday_found: r.intraday.found, price: r.price, no_levels: r.eod.noLevels || r.intraday.noLevels }]));
    for (const t of TICKERS) if (cfg.symbols[t]) {
      const mine = problems.filter(p => p.startsWith(`${t}:`));
      const r = results[t];
      say(!mine.length, `${t}: ${r?.error ? r.error : `${r.eod.found}/19 EOD · ${r.intraday.found}/19 Intraday`}`, mine.join('; '));
      if (r && (r.eod.noLevels || r.intraday.noLevels)) suggest.symbols = { ...(suggest.symbols || {}), [t]: '' };
    }
  }

  profile.issues = issues;
  mkdirSync(join(cfg.dir, 'output'), { recursive: true });
  writeFileSync(join(cfg.dir, 'output', 'profile.json'), JSON.stringify(profile, null, 2));
  console.log(issues.length ? `\n${issues.length} thing(s) to fix (details above). Saved what was found to output/profile.json.`
    : '\nEverything matches what we expect from MenthorQ. Saved to output/profile.json.');
  if (Object.keys(suggest).length) {
    if (flags.apply) {
      const p = join(cfg.dir, 'config.json');
      const raw = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
      if (suggest.layout && !raw.layout) raw.layout = suggest.layout;
      if (suggest.studies) raw.studies = suggest.studies;
      if (suggest.symbols) raw.symbols = { ...(raw.symbols || {}), ...suggest.symbols };
      writeFileSync(p, JSON.stringify(raw, null, 2) + '\n');
      console.log(`Updated config.json: ${Object.keys(suggest).join(', ')}.`);
    } else console.log(`Suggested config.json changes: ${JSON.stringify(suggest)} (run "learn --apply" to write them).`);
  }
}

async function cmdCheck(cfg) {
  const cdp = await connect(cfg);
  let all;
  try { all = await cdp.evaluate(READ_JS([])); } finally { cdp.close(); }
  console.log(`Connected to TradingView. Levels tab: ${all.layoutId || '?'} "${all.layoutName || 'unnamed'}" · ${all.symbol}`);
  if (all.frozen) console.log('⚠️  This window shows "Session disconnected": click Connect in TradingView before reading.');
  let hits = 0;
  for (const s of all.studies) {
    const hit = [cfg.studies.eod, cfg.studies.intraday].some(m => `${s.name} ${s.title}`.toLowerCase().includes(m.toLowerCase()));
    hits += hit ? 1 : 0;
    console.log(`${hit ? '  ✅' : '    '} ${s.name}${s.visible ? '' : ' (hidden)'}: ${s.labels.length} labels, ${s.cells.length} table cells`);
  }
  console.log(hits >= 2 ? '\nBoth MenthorQ indicators found. Next: node levels-relay.mjs learn'
    : '\n⚠️  Expected 2 MenthorQ indicators (EOD + Intraday). Run "node levels-relay.mjs learn".');
}

async function cmdStatus(cfg) {
  const seen = await look(cfg, { versions: true });
  console.log(`TradingView: ${seen.state === 'live' ? 'live' : STATE_TEXT[seen.state] || seen.state}${seen.error ? ` (${seen.error})` : ''}`);
  if (seen.snap) console.log(`Levels tab: ${seen.snap.layoutId} "${seen.snap.layoutName || 'unnamed'}" · ${seen.snap.symbol}`);
  if (seen.stamps) {
    console.log(`On the chart: ${stampsText(seen.stamps)}`);
    const rule = freshnessRule(cfg, etParts(sys.now()));
    if (rule) {
      const s = seen.stamps[rule.wait_for];
      console.log(`A post right now needs ${LABEL[rule.wait_for]} levels from ${rule.date}: ${s && s.date >= rule.date ? 'fresh ✅' : 'not yet'}`);
    }
    for (const k of ['eod', 'intraday']) {
      const v = seen.versions?.[k];
      if (v?.newer) console.log(`⚠️  A newer ${LABEL[k]} version is published (${v.chart} → ${v.latest}): click the purple ⟳ next to the indicator name.`);
    }
    if (seen.hiddenStudies?.length) console.log(`⚠️  Hidden on the levels tab (they don't update while hidden): ${seen.hiddenStudies.join(', ')}`);
  }
  const st = loadState(cfg);
  console.log(`Last post: ${st?.last_posted ? `${st.last_posted.at} (${st.last_posted.stamps})` : 'none yet'}`);
  console.log(`Mode: ${cfg.mode} · levels tab set: ${!!cfg.layout} · start_tradingview: ${cfg.start_tradingview} · allow_restart: ${cfg.allow_restart} · ` +
              `levels webhook set: ${!!cfg.webhook_url} · modlog webhook set: ${!!cfg.modlog_webhook_url}`);
}

async function cmdDump(cfg) {
  const cdp = await connect(cfg);
  try { console.log(JSON.stringify(await cdp.evaluate(READ_JS([cfg.studies.eod, cfg.studies.intraday])), null, 2)); } finally { cdp.close(); }
}

function printResults(results) {
  console.log('\n' + render(results).join('\n\n').replace(/\*\*/g, ''));
  for (const [t, r] of Object.entries(results))
    if (!r.error) console.log(`  ${t}: EOD ${r.eod.found}/19 from ${r.eod.source}, Intraday ${r.intraday.found}/19 from ${r.intraday.source}`);
}

async function cmdRead(cfg) {
  console.log(`levels-relay ${VERSION}${cfg.layout ? '' : ' (no levels tab set: using the tab that has MenthorQ on it)'}`);
  const results = await readAll(cfg);
  printResults(results);
  const problems = problemsWith(results, cfg, freshnessRule(cfg, etParts(sys.now())));
  save(cfg, results, problems);
  console.log(problems.length ? `\n⚠️  "post" would refuse these right now:\n  - ${problems.join('\n  - ')}` : '\nAll checks pass: "post" would send these.');
}

async function cmdPost(cfg, flags) {
  console.log(`levels-relay ${VERSION}`);
  requireWebhook(cfg);   // fail before switching any charts
  const st = loadState(cfg) || { windows: {} };
  const et = etParts(sys.now());
  try {
    const { results, stamps } = await postLevels(cfg, { rule: freshnessRule(cfg, et), force: flags.force, state: st });
    printResults(results);
    const w = activeWindow(cfg, et);
    st.windows ||= {};
    if (w) (st.windows[`${et.date} ${w.name}`] ||= {}).posted = true;   // so the watcher doesn't post the same window again
    st.last_posted = { stamps, at: `${et.date} ${et.hhmm} ET`, window: 'by hand' };
    saveState(cfg, st);
    console.log('\nPosted to Discord.');
  } catch (e) {
    if (!(e instanceof RefusedError)) throw e;
    console.error(`\nNothing was posted:\n  - ${e.problems.join('\n  - ')}`);
    if (e.problems.some(p => /not today's|already posted/.test(p)))
      console.error('\nTo post anyway (e.g. MenthorQ skipped an update), run: node levels-relay.mjs post --force\n(--force skips only the "today\'s levels" and "already posted" checks.)');
    process.exitCode = 1;
  }
}

async function cmdWatch(cfg) {
  requireWebhook(cfg);
  requireLayout(cfg);
  if (cfg.mode === 'schedule') return watchSchedule(cfg);
  console.log(`levels-relay ${VERSION} watching the levels tab (${cfg.layout}) every ${cfg.check_every_minutes} min: ` +
    cfg.windows.map(w => `${w.name} ${w.from}-${w.to} ET waits for ${LABEL[w.wait_for]}`).join(', ') + '. Ctrl+C to stop.');
  if (cfg.start_tradingview || cfg.allow_restart)
    console.log(`  allowed to ${[cfg.start_tradingview && 'start TradingView when it\'s closed', cfg.allow_restart && 'restart TradingView'].filter(Boolean).join(' and ')}.`);
  let st = loadState(cfg);
  if (!st) {
    // First run: whatever is on the chart now counts as already handled, so a fresh
    // install never re-posts levels someone already shared today.
    st = { windows: {} };
    const seen = await look(cfg);
    if (seen.state === 'live') st.last_posted = { stamps: stampsText(seen.stamps), at: 'before the watcher started', window: 'baseline' };
    saveState(cfg, st);
  }
  for (;;) {
    try { st = await watchTick(cfg, st); } catch (e) { console.error(`  check failed: ${e.message}`); }
    try { saveState(cfg, st); } catch (e) { console.error(`  couldn't save output/state.json: ${e.message}`); }
    await sleep(cfg.check_every_minutes * 60000);
  }
}

async function watchSchedule(cfg) {
  console.log(`levels-relay ${VERSION} watching. Posts at ${cfg.schedule_et.join(', ')} ET if the levels are fresh. Ctrl+C to stop.`);
  const done = new Set();
  for (;;) {
    const et = etParts(sys.now()), key = `${et.date} ${et.hhmm}`;
    const day = et.hhmm >= '15:00' ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5];
    if (cfg.schedule_et.includes(et.hhmm) && day.includes(et.dow) && !done.has(key)) {
      done.add(key);
      const st = loadState(cfg) || { windows: {} };
      try {
        const { stamps } = await postLevels(cfg, { rule: freshnessRule(cfg, et), state: st });
        st.last_posted = { stamps, at: `${et.date} ${et.hhmm} ET`, window: 'schedule' };
        saveState(cfg, st);
        console.log(`[${et.hhmm} ET] posted.`);
      } catch (e) { console.error(`[${et.hhmm} ET] ${e.message}`); await report(cfg, `scheduled post at ${et.hhmm} ET: ${e.message}`); }
    }
    await sleep(20000);
  }
}

function cmdValidate(cfg, flags) {
  requireWebhook(cfg);
  if (flags.watch) requireLayout(cfg);
  if (cfg.allow_restart) console.log('Note: allow_restart is on, so the watcher may quit and restart TradingView on this computer.');
  if (cfg.start_tradingview) console.log('Note: start_tradingview is on, so the watcher opens TradingView (in the background) when it\'s closed.');
  console.log('config.json looks good.');
}

function cmdSelftest() {
  const cases = [
    ['GEX 1', ['GEX 1']], ['GEX10', ['GEX 10']], ['Call Resistance 0DTE / Gamma Wall 0DTE', ['CALL RESISTANCE 0DTE', 'GAMMA WALL 0DTE']],
    ['HVL\nHVL 0DTE', ['HVL', 'HVL 0DTE']], ['1-Day Max', ['1D MAX']], ['Put Support 30,750.25', ['PUT SUPPORT']],
    ['Call Resistance / Call Resistance 0DTE / Gamma Wall 0DTE', ['CALL RESISTANCE', 'CALL RESISTANCE 0DTE', 'GAMMA WALL 0DTE']],
    ['Flow Model V2', []], ['Call Resistance (SPX)', []],
  ];
  let bad = 0;
  const check = (ok, text) => { bad += ok ? 0 : 1; console.log(`${ok ? '✅' : '❌'} ${text}`); };
  for (const [input, want] of cases) {
    const got = namesIn(input);
    check(JSON.stringify(got) === JSON.stringify(want), `${JSON.stringify(input)} -> ${JSON.stringify(got)}`);
  }
  check(JSON.stringify(namesIn('Gamma Flip', { 'gamma flip': 'HVL' })) === '["HVL"]', 'aliases: "Gamma Flip" -> HVL');
  // the timestamp formats seen on real MenthorQ charts
  for (const [input, want] of [['End of Day Levels\nLast Update: 2026-10-13 22:27', '2026-10-13 22:27'],
    ['Intraday Levels\nLast Update: 2026-10-14 08:00 EST', '2026-10-14 08:00 EST'], ['Last Update: 2026-10-14 8:00 31400', '2026-10-14 08:00'], ['Updated recently', null]]) {
    const got = parseStamp(input)?.text ?? null;
    check(got === want, `stamp ${JSON.stringify(input)} -> ${got}`);
  }
  // a Key Levels table as MenthorQ draws it, with the timestamp box in the same grid
  const cells = [['Key Levels', 'Value', 'Distance to Spot'], ['GEX 1', '30650', '0.16%'], ['Call Resistance / Call Resistance 0DTE / Gamma Wall 0DTE', '31050', '1.47%'],
                 ['HVL / HVL 0DTE', '30625', '0.08%'], ['1D Max', '31135.5', '1.75%'], ['1D Min', '30064.5', '-1.75%']]
    .flatMap((row, r) => row.map((t, c) => ({ t, r, c, tid: 0 })))
    .concat([{ t: 'End of Day Levels\nLast Update: 2026-10-13 22:27', r: 1, c: 0, tid: 0 }]);   // collides with row 1 on purpose
  const p = parseSession({ cells, labels: [], lines: [] });
  const want = '30650,0,0,0,0,0,0,0,0,0,31050,31050,0,0,30625,30625,31050,31135.5,30064.5';
  check(fmt(p.values) === want && p.source === 'table' && p.stamp?.text === '2026-10-13 22:27', `Key Levels table -> ${fmt(p.values)} (stamp ${p.stamp?.text})`);
  console.log(bad ? `\n${bad} check(s) failed.` : '\nAll checks passed.');
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- main
async function main(argv) {
  if (Number(process.versions.node.split('.')[0]) < 22) {
    console.error(`levels-relay needs Node.js 22 or newer; this computer has ${process.version}. Install the LTS version from https://nodejs.org, then open a new terminal window.`);
    process.exit(1);
  }
  const cmd = argv[0] || 'read';
  const flags = Object.fromEntries(argv.slice(1).filter(a => a.startsWith('--')).map(a => [a.slice(2), true]));
  if (cmd === 'selftest') return cmdSelftest();
  let cfg;
  try { cfg = loadConfig(); } catch (e) { console.error('Error:', e.message); process.exit(1); }
  const run = { validate: cmdValidate, tabs: cmdTabs, learn: cmdLearn, check: cmdCheck, status: cmdStatus, dump: cmdDump,
    read: cmdRead, post: cmdPost, watch: cmdWatch }[cmd];
  if (!run) { console.log(`Unknown command "${cmd}". Use one of: selftest, validate, tabs, learn, check, status, dump, read, post, watch.`); process.exit(2); }
  try { await run(cfg, flags); } catch (e) { console.error('Error:', e.message); process.exit(1); }
}

// Run only when started directly (not when imported by the tests). Node resolves
// symlinks for the module path, so compare real paths (case-insensitive on Windows).
const isMain = (() => {
  try {
    const norm = p => (IS_WIN ? p.toLowerCase() : p);
    return !!process.argv[1] && norm(realpathSync(resolve(process.argv[1]))) === norm(realpathSync(fileURLToPath(import.meta.url)));
  } catch { return false; }
})();
if (isMain) main(process.argv.slice(2));

export {
  VERSION, DEFAULTS, MENTHORQ, ORDER, TICKERS, sys, normalizeConfig, loadConfig, namesIn, unknownIn, parseStamp, fromTable, fromLabels,
  parseSession, problemsWith, freshnessRule, activeWindow, etParts, readAll, look, postLevels, watchTick, missedText, render, stampsOf,
  loadState, saveState, RefusedError, FrozenError,
};
