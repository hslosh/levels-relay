#!/usr/bin/env node
/**
 * levels-relay: read MenthorQ gamma levels straight off TradingView Desktop and
 * turn them into the 38-number strings the "Auto-GEX Master Levels" / "Option
 * Levels" indicator takes. Optionally posts them to Discord through a webhook.
 *
 * Zero dependencies: Node 22+ (built-in fetch + WebSocket). Nothing is
 * installed and nothing leaves the machine except the optional webhook post.
 *
 *   node levels-relay.mjs selftest   check the parser (no TradingView needed)
 *   node levels-relay.mjs check      connect + list what the chart has loaded
 *   node levels-relay.mjs status     is the chart live? current MenthorQ "Last Update" stamp
 *   node levels-relay.mjs dump       raw MenthorQ labels/lines/tables on the current chart
 *   node levels-relay.mjs read       step through every symbol, print the strings
 *   node levels-relay.mjs post       read, then post to the Discord webhook
 *   node levels-relay.mjs watch      stay running; post when MenthorQ updates (or at set times)
 *
 * TradingView Desktop must be started with the debug port (start-tradingview.*).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = '1.2.1';

// ---------------------------------------------------------------- config
const DEFAULTS = {
  port: 9222,
  // Optional: part of the chart URL (the layout id after /chart/) of a spare
  // window to use, so the window you trade on never changes symbol.
  layout: '',
  webhook_url: '',
  webhook_name: 'Option Levels',
  symbols: {
    NQ: 'CME_MINI:NQ1!',
    ES: 'CME_MINI:ES1!',
    GC: 'COMEX:GC1!',
    OIL: 'NYMEX:CL1!',
    SILVER: 'COMEX:SI1!',
  },
  // Substrings of the indicator names on the chart (case-insensitive).
  studies: { eod: 'MenthorQ Gamma Levels EOD', intraday: 'MenthorQ Gamma Levels Intraday' },
  // ET times for `watch` (24h). Morning runs Mon-Fri, evening runs Sun-Thu.
  schedule_et: ['08:05', '20:05'],
  // "update": post as soon as MenthorQ's "Last Update" stamp changes (checked
  // every few minutes inside the windows below). "schedule": post at schedule_et.
  mode: 'update',
  update_windows_et: [['07:30', '11:30'], ['19:00', '23:00']],
  update_check_minutes: 3,
  // Start TradingView (with the debug port) if it's closed. Harmless.
  start_tradingview: true,
  // Restart TradingView to take the session back when another device (phone,
  // laptop) has it. Bumps that device for about a minute, so it's opt-in.
  take_back_session: false,
  // Where failure notices go: a webhook in a private channel such as #modlog.
  // Failures are NEVER posted to the main levels channel; if this is empty
  // they're only written to output/watch.log.
  modlog_webhook_url: '',
  settle_seconds: 25,
};

function loadConfig() {
  const p = join(HERE, 'config.json');
  let user = {};
  if (existsSync(p)) {
    try { user = JSON.parse(readFileSync(p, 'utf8')); }
    catch (e) { throw new Error(`config.json isn't valid JSON (${e.message}). Compare it with config.example.json.`); }
  }
  if ('manage_tradingview' in user && !('take_back_session' in user)) user.take_back_session = !!user.manage_tradingview;
  if (user.alert_webhook_url && !user.modlog_webhook_url) user.modlog_webhook_url = user.alert_webhook_url;
  // the example config's "PASTE_..." placeholders mean "not set"
  for (const k of ['webhook_url', 'modlog_webhook_url']) if (typeof user[k] === 'string' && !/^https:\/\//.test(user[k].trim())) user[k] = '';
  return { ...DEFAULTS, ...user, symbols: { ...DEFAULTS.symbols, ...(user.symbols || {}) },
           studies: { ...DEFAULTS.studies, ...(user.studies || {}) } };
}

// ---------------------------------------------------------------- level names
// The indicator's fixed order: 19 EOD values, then the same 19 Intraday.
const ORDER = ['GEX 1', 'GEX 2', 'GEX 3', 'GEX 4', 'GEX 5', 'GEX 6', 'GEX 7', 'GEX 8', 'GEX 9', 'GEX 10',
  'CALL RESISTANCE', 'CALL RESISTANCE 0DTE', 'PUT SUPPORT', 'PUT SUPPORT 0DTE',
  'HVL', 'HVL 0DTE', 'GAMMA WALL 0DTE', '1D MAX', '1D MIN'];
const TICKERS = ['NQ', 'ES', 'GC', 'OIL', 'SILVER'];

// "Call Resistance 0DTE / Gamma Wall 0DTE" -> two names. Tolerates newlines,
// extra spaces, "1-Day Max", "GEX10" and a trailing price ("HVL 30,910.00").
function namesIn(text) {
  const norm = s => s.toUpperCase().replace(/1[\s-]*DAY/g, '1D').replace(/GEX\s*(\d+)/g, 'GEX $1')
    .replace(/\s+/g, ' ').trim();
  return String(text || '')
    .split(/\/|\n|\|/)
    .map(part => {
      const n = norm(part);
      if (ORDER.includes(n)) return n;
      const stripped = norm(part.replace(/[:=]?\s*[-+]?\d[\d,]*\.\d+\s*$|[:=]\s*[-+]?\d[\d,]*\s*$/, ''));
      return ORDER.includes(stripped) ? stripped : null;
    })
    .filter(Boolean);
}

const num = s => { const x = parseFloat(String(s).replace(/,/g, '')); return isFinite(x) ? x : null; };

// ---------------------------------------------------------------- CDP
async function cdpTargets(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
  if (!r) throw new Error(`TradingView isn't reachable on port ${port}. Close TradingView fully, then start it with start-tradingview.`);
  return (await r.json()).filter(t => t.type === 'page' && /tradingview\.com\/chart/.test(t.url || ''));
}

async function connect(port, layout = '') {
  const targets = await cdpTargets(port);
  if (!targets.length) throw new Error('No TradingView chart window found. Open a chart first.');
  const target = layout ? targets.find(t => t.url.includes(layout)) : targets[0];
  if (!target) throw new Error(`No open window has layout "${layout}". Open it, or clear "layout" in config.json.`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('Could not open the debug connection')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise(res => {
    const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expression) => {
    const m = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description || 'eval failed');
    return m.result?.result?.value;
  };
  return { evaluate, close: () => ws.close() };
}

const CHART = 'window.TradingViewApi._activeChartWidgetWV.value()';

// Every matching study with its labels, horizontal lines and table cells.
const READ_JS = (match) => `(function(){
  var match = ${JSON.stringify(match.map(s => s.toLowerCase()))};
  var cw = ${CHART}._chartWidget; var out = [];
  cw.model().model().dataSources().forEach(function(s){
    if (!s.metaInfo) return;
    var meta = s.metaInfo(); var name = meta.description || meta.shortDescription || '';
    var title = ''; try { title = s.title ? s.title() : ''; } catch(e) {}
    var hay = (name + ' ' + title).toLowerCase();
    if (match.length && !match.some(function(m){ return hay.indexOf(m) >= 0; })) return;
    var g = s._graphics, pc = g && g._primitivesCollection;
    function coll(a, b){ var o = []; try { var c = pc[a].get(b).get(false);
      c._primitivesDataById.forEach(function(v){ o.push(v); }); } catch(e) {} return o; }
    var vis = true; try { vis = s.properties().visible.value(); } catch(e) {}
    out.push({ id: s.id ? s.id() : null, name: name, title: title, visible: vis,
      labels: coll('dwglabels','labels').map(function(v){ return { t: v.t || '', y: v.y }; }),
      lines: coll('dwglines','lines').filter(function(v){ return v.y1 === v.y2; }).map(function(v){ return v.y1; }),
      cells: coll('dwgtablecells','tableCells').map(function(v){ return { t: v.t || '', r: v.row, c: v.col, tid: v.tid || 0 }; }) });
  });
  var txt = (document.body && document.body.innerText) || '';
  return { symbol: ${CHART}.symbol(), frozen: txt.indexOf('Session disconnected') >= 0, studies: out };
})()`;

const SET_VISIBLE_JS = (ids, on) => `(function(){ var c = ${CHART}; var n = 0;
  ${JSON.stringify(ids)}.forEach(function(id){ try { var s = c.getStudyById(id);
    s.setVisible ? s.setVisible(${on}) : s.properties().visible.setValue(${on}); n++; } catch(e) {} }); return n; })()`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function setSymbol(cdp, sym) {
  await cdp.evaluate(`(function(){ ${CHART}.setSymbol(${JSON.stringify(sym)}, {}); return true; })()`);
  const root = sym.split(':').pop();
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const cur = await cdp.evaluate(`${CHART}.symbol()`);
    if (cur && cur.split(':').pop() === root) return true;
  }
  return false;
}

// ---------------------------------------------------------------- parsing
// 1) A "Key Levels" style table (name | value | ...) gives exact values.
function fromTable(cells) {
  const rows = {};
  for (const c of cells || []) (rows[`${c.tid}:${c.r}`] ||= {})[c.c] = c.t;
  const out = {};
  for (const row of Object.values(rows)) {
    const cols = Object.keys(row).map(Number).sort((a, b) => a - b);
    if (cols.length < 2) continue;
    const names = namesIn(row[cols[0]]);
    const value = num(row[cols[1]]);
    if (names.length && value) for (const n of names) out[n] = value;
  }
  return out;
}

// 2) Otherwise the labels drawn on the chart (each sits on its level's line).
function fromLabels(labels, lines) {
  const out = {};
  for (const lab of labels || []) {
    const names = namesIn(lab.t);
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

function parseSession(study) {
  const table = fromTable(study.cells);
  const labels = fromLabels(study.labels, study.lines);
  const found = Object.keys(table).length >= 5 ? table : { ...labels, ...table };
  const values = ORDER.map(n => found[n] || 0);
  const text = (study.cells || []).map(c => c.t).concat((study.labels || []).map(l => l.t)).join(' ');
  const updated = (text.match(/Last Update:?\s*([0-9:\-\s]+(?:EST|EDT|ET)?)/i) || [])[1];
  return { values, found: Object.keys(found).length, source: Object.keys(table).length >= 5 ? 'table' : 'labels',
           updated: updated ? updated.trim() : null };
}

async function readStable(cdp, match, settleMs) {
  // Studies recalculate after a symbol change; wait until the output stops changing.
  let last = '', stableFor = 0, snap = null;
  const t0 = Date.now();
  while (Date.now() - t0 < settleMs) {
    snap = await cdp.evaluate(READ_JS(match));
    const key = JSON.stringify(snap.studies.map(s => [s.labels.map(l => l.t + l.y), s.cells.map(c => c.t)]));
    const hasData = snap.studies.some(s => s.labels.length || s.cells.length);
    stableFor = (key === last && hasData) ? stableFor + 1 : 0;
    last = key;
    if (stableFor >= 2) break;
    await sleep(1000);
  }
  return snap;
}

const fmt = v => v.map(x => (x ? +(+x).toFixed(4) : 0)).join(',');

async function readAll(cfg, log = console.log) {
  const cdp = await connect(cfg.port, cfg.layout);
  const match = [cfg.studies.eod, cfg.studies.intraday];
  const start = await cdp.evaluate(READ_JS(match));
  if (start.frozen) {
    cdp.close();
    throw new Error('This TradingView shows "Session disconnected" (another device has the session), so the chart is frozen. Click Connect in TradingView, then try again.');
  }
  if (!start.studies.length) {
    cdp.close();
    throw new Error(`No MenthorQ indicator on the active chart (looking for "${cfg.studies.eod}" / "${cfg.studies.intraday}"). Run "check" to see what's loaded.`);
  }
  const originalSymbol = start.symbol;
  const hidden = start.studies.filter(s => !s.visible).map(s => s.id).filter(Boolean);
  // Hidden indicators don't calculate, so show them for the read and hide them again after.
  if (hidden.length) await cdp.evaluate(SET_VISIBLE_JS(hidden, true));
  const results = {};
  try {
    for (const t of TICKERS) {
      const sym = cfg.symbols[t];
      if (!sym) continue;
      log(`  reading ${t} (${sym})...`);
      if (!(await setSymbol(cdp, sym))) { log(`  ${t}: chart didn't switch, skipped`); continue; }
      const snap = await readStable(cdp, match, cfg.settle_seconds * 1000);
      const pick = key => snap.studies.find(s => (s.name + ' ' + s.title).toLowerCase().includes(cfg.studies[key].toLowerCase()));
      const eod = pick('eod'), intra = pick('intraday');
      const empty = { values: new Array(19).fill(0), found: 0, source: '-', updated: null };
      const e = eod ? parseSession(eod) : empty;
      const i = intra ? parseSession(intra) : empty;
      results[t] = { string: fmt(e.values.concat(i.values)), eod_found: e.found, intraday_found: i.found,
                     eod_source: e.source, intraday_source: i.source, eod_updated: e.updated, intraday_updated: i.updated };
    }
  } finally {
    await setSymbol(cdp, originalSymbol);
    if (hidden.length) await cdp.evaluate(SET_VISIBLE_JS(hidden, false));
    cdp.close();
  }
  return results;
}

// ---------------------------------------------------------------- output
const nowET = () => new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function render(results) {
  const first = Object.values(results)[0] || {};
  const upd = [first.eod_updated && `EOD ${first.eod_updated}`, first.intraday_updated && `Intraday ${first.intraday_updated}`].filter(Boolean).join(' · ');
  const parts = [`📊 **MenthorQ option levels** · ${nowET()} ET${upd ? `\nLast update: ${upd}` : ''}\n` +
                 `Paste each line into the matching box of the Option Levels / Auto-GEX indicator.`];
  for (const t of TICKERS) {
    const r = results[t];
    if (!r) continue;
    const note = (r.eod_found < 10 || r.intraday_found < 10) ? `  _(EOD ${r.eod_found}/19 · Intraday ${r.intraday_found}/19 on chart)_` : '';
    parts.push(`**${t}**${note}\n\`\`\`\n${r.string}\n\`\`\``);
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
      body: JSON.stringify({ username: cfg.webhook_name, content: c, allowed_mentions: { parse: [] } }) });
    if (!r.ok) throw new Error(`Discord said ${r.status}: ${await r.text()}`);
    await sleep(600);
  }
}

function save(results) {
  const dir = join(HERE, 'output');
  if (!existsSync(dir)) mkdirSync(dir);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  writeFileSync(join(dir, `levels-${stamp}.json`), JSON.stringify(results, null, 2));
  writeFileSync(join(dir, 'latest.txt'), render(results).join('\n\n').replace(/\*\*|`{3}|_/g, '') + '\n');
}

// ---------------------------------------------------------------- self-healing
const IS_WIN = process.platform === 'win32';

function tvRunning() {
  try {
    if (IS_WIN) return /TradingView\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq TradingView.exe"', { encoding: 'utf8' }));
    return execSync('pgrep -x TradingView || true', { encoding: 'utf8' }).trim().length > 0;
  } catch { return false; }
}

function tvLaunch() {
  if (IS_WIN) {
    const ps = "$p = Get-AppxPackage TradingView.Desktop; if ($p) { Start-Process (Join-Path $p.InstallLocation 'TradingView.exe') -ArgumentList '--remote-debugging-port=9222' } " +
               "elseif (Test-Path \"$env:LOCALAPPDATA\\Programs\\TradingView\\TradingView.exe\") { Start-Process \"$env:LOCALAPPDATA\\Programs\\TradingView\\TradingView.exe\" -ArgumentList '--remote-debugging-port=9222' }";
    spawn('powershell', ['-NoProfile', '-Command', ps], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('open', ['-a', 'TradingView', '--args', '--remote-debugging-port=9222'], { detached: true, stdio: 'ignore' }).unref();
  }
}

function tvKill() {
  try {
    if (IS_WIN) execSync('taskkill /F /IM TradingView.exe /T', { stdio: 'ignore' });
    else execSync('osascript -e \'quit app "TradingView"\'', { stdio: 'ignore' });
  } catch { /* already closed */ }
}

async function waitForChart(cfg, seconds = 120) {
  for (let i = 0; i < seconds / 3; i++) {
    try { if ((await cdpTargets(cfg.port)).length) { await sleep(15000); return true; } } catch { /* not up yet */ }
    await sleep(3000);
  }
  return false;
}

// Make sure a live (not frozen) chart is reachable. Never reloads the page:
// a reload through the debug connection can log TradingView out.
async function ensureTradingView(cfg, log = console.log) {
  let reachable = false;
  try { reachable = (await cdpTargets(cfg.port)).length > 0; } catch { reachable = false; }
  if (!reachable) {
    if (!cfg.start_tradingview) throw new Error('TradingView isn\'t reachable on the debug port, and start_tradingview is off.');
    if (tvRunning()) { log('  TradingView is running without the debug port: restarting it'); tvKill(); await sleep(4000); }
    else log('  TradingView is closed: starting it');
    tvLaunch();
    if (!(await waitForChart(cfg))) throw new Error('TradingView did not come up with a chart within 2 minutes.');
  }
  const cdp = await connect(cfg.port, cfg.layout);
  const frozen = await cdp.evaluate("((document.body && document.body.innerText) || '').indexOf('Session disconnected') >= 0");
  cdp.close();
  if (!frozen) return;
  if (!cfg.take_back_session) throw new Error('the chart shows "Session disconnected" because another device (phone/laptop) has the TradingView session. Click Connect on this computer, or set take_back_session to true to let the tool do it.');
  log('  chart is frozen (another device has the session): restarting TradingView to take it back');
  tvKill(); await sleep(4000); tvLaunch();
  if (!(await waitForChart(cfg))) throw new Error('TradingView did not come back after the restart.');
}

async function reportFailure(cfg, message) {
  const line = `[${nowET()} ET] couldn't post the levels: ${message}`;
  try { mkdirSync(join(HERE, 'output'), { recursive: true }); writeFileSync(join(HERE, 'output', 'failures.log'), line + '\n', { flag: 'a' }); } catch { /* ignore */ }
  const url = cfg.modlog_webhook_url;     // never the main channel
  if (!url || url === cfg.webhook_url) return;
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cfg.webhook_name, content: `⚠️ levels-relay couldn't post the levels: ${message}`.slice(0, 1900), allowed_mentions: { parse: [] } }) });
  } catch { /* nothing else we can do */ }
}

// The "Last Update" stamps on the current chart (no symbol switching).
async function currentStamp(cfg) {
  const cdp = await connect(cfg.port, cfg.layout);
  try {
    const snap = await cdp.evaluate(READ_JS([cfg.studies.eod, cfg.studies.intraday]));
    if (snap.frozen) return null;
    const txt = snap.studies.flatMap(s => s.cells.map(c => c.t).concat(s.labels.map(l => l.t))).join(' ');
    const stamps = [...txt.matchAll(/Last Update:?\s*([0-9:\-\s]+(?:EST|EDT|ET)?)/gi)].map(m => m[1].trim()).sort();
    return stamps.length ? stamps.join(' | ') : null;
  } finally { cdp.close(); }
}

// ---------------------------------------------------------------- commands
async function cmdCheck(cfg) {
  const cdp = await connect(cfg.port, cfg.layout);
  const all = await cdp.evaluate(READ_JS([]));
  cdp.close();
  console.log(`Connected to TradingView. Chart: ${all.symbol}`);
  if (all.frozen) console.log('⚠️  This window shows "Session disconnected": click Connect in TradingView before reading.');
  let hits = 0;
  for (const s of all.studies) {
    const hit = [cfg.studies.eod, cfg.studies.intraday].some(m => (s.name + ' ' + s.title).toLowerCase().includes(m.toLowerCase()));
    hits += hit ? 1 : 0;
    console.log(`${hit ? '  ✅' : '    '} ${s.name}${s.visible ? '' : ' (hidden)'}: ${s.labels.length} labels, ${s.cells.length} table cells`);
  }
  console.log(hits >= 2 ? '\nBoth MenthorQ indicators found. Next: node levels-relay.mjs read'
    : '\n⚠️  Expected 2 MenthorQ indicators (EOD + Intraday). Put their exact names in config.json → "studies".');
}

async function cmdStatus(cfg) {
  const cdp = await connect(cfg.port, cfg.layout);
  const snap = await cdp.evaluate(READ_JS([cfg.studies.eod, cfg.studies.intraday]));
  cdp.close();
  console.log(`Chart: ${snap.symbol} · ${snap.frozen ? 'FROZEN (Session disconnected)' : 'live'} · MenthorQ indicators: ${snap.studies.length}`);
  console.log(`Last update stamp(s): ${snap.frozen ? '(chart frozen)' : (await currentStamp(cfg)) || 'none found'}`);
  console.log(`Mode: ${cfg.mode} · start_tradingview: ${cfg.start_tradingview} · take_back_session: ${cfg.take_back_session} · levels webhook set: ${!!cfg.webhook_url} · modlog webhook set: ${!!cfg.modlog_webhook_url}`);
}

async function cmdDump(cfg) {
  const cdp = await connect(cfg.port, cfg.layout);
  const snap = await cdp.evaluate(READ_JS([cfg.studies.eod, cfg.studies.intraday]));
  cdp.close();
  console.log(JSON.stringify(snap, null, 2));
}

async function cmdRead(cfg, post) {
  console.log(`levels-relay ${VERSION}`);
  if (post) requireWebhook(cfg);   // fail before switching any charts
  const results = await readAll(cfg);
  const parts = render(results);
  console.log('\n' + parts.join('\n\n').replace(/\*\*/g, ''));
  for (const [t, r] of Object.entries(results)) console.log(`  ${t}: EOD from ${r.eod_source}, Intraday from ${r.intraday_source}`);
  save(results);
  if (post) { await postWebhook(cfg, parts); console.log('\nPosted to Discord.'); }
  return results;
}

async function runOnce(cfg, why) {
  console.log(`[${nowET()} ET] ${why}`);
  try {
    await ensureTradingView(cfg);
    await cmdRead(cfg, true);
    return true;
  } catch (e) {
    console.error('  run failed:', e.message);
    await reportFailure(cfg, e.message);
    return false;
  }
}

async function cmdWatch(cfg) {
  requireWebhook(cfg);
  const etNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const tradingSlot = et => {
    const hhmm = et.toTimeString().slice(0, 5), day = et.getDay();
    return hhmm >= '17:00' ? (day >= 0 && day <= 4) : (day >= 1 && day <= 5);
  };
  if (cfg.mode === 'update') {
    console.log(`levels-relay ${VERSION} watching for MenthorQ updates (every ${cfg.update_check_minutes} min, ` +
                `${cfg.update_windows_et.map(w => w.join('-')).join(' and ')} ET). Ctrl+C to stop.`);
    const statePath = join(HERE, 'output', 'last_stamp.txt');
    let last = existsSync(statePath) ? readFileSync(statePath, 'utf8').trim() : '';
    const fallbackDone = new Set();
    let lastErr = '', lastErrAt = 0;
    for (;;) {
      const et = etNow(), hhmm = et.toTimeString().slice(0, 5);
      if (tradingSlot(et) && cfg.update_windows_et.some(([a, b]) => hhmm >= a && hhmm <= b)) {
        try {
          await ensureTradingView(cfg);
          const stamp = await currentStamp(cfg);
          // Safety net: if no "Last Update" stamp can be read at all, fall
          // back to posting at the schedule_et times so nothing is missed.
          const slot = et.toDateString() + hhmm;
          if (!stamp && cfg.schedule_et.includes(hhmm) && !fallbackDone.has(slot)) {
            fallbackDone.add(slot);
            await runOnce(cfg, `no "Last Update" stamp found: scheduled fallback post (${hhmm} ET)`);
          }
          if (stamp && stamp !== last) {
            if (await runOnce(cfg, `MenthorQ updated (${stamp}): posting`)) {
              last = stamp;
              mkdirSync(join(HERE, 'output'), { recursive: true });
              writeFileSync(statePath, stamp);
            }
          }
        } catch (e) {
          console.error(`[${hhmm} ET] check failed:`, e.message);
          // tell #modlog, but at most once an hour for the same problem
          if (e.message !== lastErr || Date.now() - lastErrAt > 3600000) {
            lastErr = e.message; lastErrAt = Date.now();
            await reportFailure(cfg, e.message);
          }
        }
      }
      const nearSlot = cfg.schedule_et.some(t => { const [h, m] = t.split(':').map(Number); const mins = h * 60 + m - (et.getHours() * 60 + et.getMinutes()); return mins > 0 && mins <= cfg.update_check_minutes; });
      await sleep(nearSlot ? 30000 : cfg.update_check_minutes * 60000);
    }
  }
  console.log(`levels-relay ${VERSION} watching. Posts at ${cfg.schedule_et.join(', ')} ET (mornings Mon-Fri, evenings Sun-Thu). Ctrl+C to stop.`);
  const done = new Set();
  for (;;) {
    const et = etNow(), hhmm = et.toTimeString().slice(0, 5), key = et.toDateString() + hhmm;
    if (cfg.schedule_et.includes(hhmm) && tradingSlot(et) && !done.has(key)) {
      done.add(key);
      await runOnce(cfg, `scheduled post (${hhmm} ET)`);
    }
    await sleep(20000);
  }
}

function cmdSelftest() {
  const cases = [
    ['GEX 1', ['GEX 1']], ['GEX10', ['GEX 10']], ['Call Resistance 0DTE / Gamma Wall 0DTE', ['CALL RESISTANCE 0DTE', 'GAMMA WALL 0DTE']],
    ['HVL\nHVL 0DTE', ['HVL', 'HVL 0DTE']], ['1-Day Max', ['1D MAX']], ['Put Support 30,750.25', ['PUT SUPPORT']],
    ['Call Resistance / Call Resistance 0DTE / Gamma Wall 0DTE', ['CALL RESISTANCE', 'CALL RESISTANCE 0DTE', 'GAMMA WALL 0DTE']],
    ['Flow Model V2', []],
  ];
  let bad = 0;
  for (const [input, want] of cases) {
    const got = namesIn(input);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    bad += ok ? 0 : 1;
    console.log(`${ok ? '✅' : '❌'} ${JSON.stringify(input)} -> ${JSON.stringify(got)}`);
  }
  // a Key Levels table, as MenthorQ draws it
  const cells = [['Key Levels', 'Value'], ['GEX 1', '30500'], ['Call Resistance / Call Resistance 0DTE / Gamma Wall 0DTE', '31000'],
                 ['HVL / HVL 0DTE', '30750'], ['1D Max', '31135.99'], ['1D Min', '30428.01']]
    .flatMap((row, r) => row.map((t, c) => ({ t, r, c, tid: 0 })));
  const p = parseSession({ cells, labels: [], lines: [] });
  const want = '30500,0,0,0,0,0,0,0,0,0,31000,31000,0,0,30750,30750,31000,31135.99,30428.01';
  const ok = fmt(p.values) === want && p.source === 'table';
  bad += ok ? 0 : 1;
  console.log(`${ok ? '✅' : '❌'} Key Levels table -> ${fmt(p.values)}`);
  console.log(bad ? `\n${bad} check(s) failed.` : '\nAll checks passed.');
  process.exit(bad ? 1 : 0);
}

if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error(`levels-relay needs Node.js 22 or newer; this computer has ${process.version}. Install the LTS version from https://nodejs.org, then open a new terminal window.`);
  process.exit(1);
}
const cmd = process.argv[2] || 'read';
if (cmd === 'selftest') cmdSelftest();
else {
  let cfg;
  try { cfg = loadConfig(); } catch (e) { console.error('Error:', e.message); process.exit(1); }
  const run = { validate: async c => { requireWebhook(c); console.log('config.json looks good.'); }, check: cmdCheck, status: cmdStatus, dump: cmdDump, read: c => cmdRead(c, false), post: c => cmdRead(c, true), watch: cmdWatch }[cmd];
  if (!run) { console.log(`Unknown command "${cmd}". Use one of: selftest, validate, check, status, dump, read, post, watch.`); process.exit(2); }
  run(cfg).catch(e => { console.error('Error:', e.message); process.exit(1); });
}
