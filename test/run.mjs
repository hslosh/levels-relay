// End-to-end tests against a fake TradingView (test/mock-tv.mjs). No real
// TradingView, MenthorQ or Discord is touched. Run: node test/run.mjs
process.env.LEVELS_RELAY_POLL_MS = '150';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTab, startMockTV, expectedString, SYMBOLS } from './mock-tv.mjs';
const R = await import('../levels-relay.mjs');

// ---- capture Discord posts instead of sending them
const LEVELS = 'https://discord.com/api/webhooks/1/levels', MODLOG = 'https://discord.com/api/webhooks/2/modlog';
const posts = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://discord.com/')) { posts.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); }
  return realFetch(url, init);
};
const levelPosts = () => posts.filter(p => p.url.startsWith(LEVELS));
const modlogPosts = () => posts.filter(p => p.url.startsWith(MODLOG));

// ---- spies: the tool must never launch or quit TradingView unless config allows it
const calls = { launch: 0, quit: 0, notify: [] };
R.sys.running = () => false;
R.sys.launch = () => { calls.launch++; throw new Error('(test) launch called'); };
R.sys.quit = () => { calls.quit++; };
R.sys.notify = (cfg, msg) => { calls.notify.push(msg); };

const cfgFor = (port, extra = {}) => ({ ...R.normalizeConfig({ webhook_url: LEVELS, modlog_webhook_url: MODLOG, layout: 'LEVELS1',
  settle_seconds: 6, timeout_seconds: 3, ...extra }), port, dir: mkdtempSync(join(tmpdir(), 'lr-')) });
const quiet = () => {};
const et = s => new Date(`${s}-04:00`);   // Eastern daylight time

let failed = 0, n = 0;
async function test(name, fn) {
  n++;
  try { await fn(); console.log(`✅ ${name}`); }
  catch (e) { failed++; console.log(`❌ ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ')}`); }
}
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const eq = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
async function withTV(tabs, fn) {
  const tv = await startMockTV(tabs);
  try { await fn(tv); } finally { await tv.close(); }
}

// ---------------------------------------------------------------- config + time
await test('config: old settings map to the new ones; placeholders count as unset', () => {
  const c = R.normalizeConfig({ take_back_session: true, update_windows_et: [['07:30', '11:30'], ['19:00', '23:00']],
    webhook_url: 'PASTE_YOUR_DISCORD_WEBHOOK_URL_HERE', layout: 'https://www.tradingview.com/chart/AbC123/', symbols: { SILVER: '' } });
  eq([c.allow_restart, c.windows.map(w => w.wait_for), c.webhook_url, c.layout, 'SILVER' in c.symbols], [true, ['intraday', 'eod'], '', 'AbC123', false], 'normalized');
  eq([R.DEFAULTS.start_tradingview, R.DEFAULTS.allow_restart], [false, false], 'TradingView management is off by default');
});

await test('config: a bad window is a clear error', () => {
  let msg = '';
  try { R.normalizeConfig({ windows: [{ name: 'x', from: '8:00', to: '11:30', wait_for: 'eod' }] }); } catch (e) { msg = e.message; }
  assert(/HH:MM/.test(msg), msg);
});

await test('freshness: evening waits for EOD, morning for Intraday, early morning for last night', () => {
  const c = R.normalizeConfig({});
  const rule = s => { const r = R.freshnessRule(c, R.etParts(et(s))); return `${r.window}/${r.wait_for}/${r.date}`; };
  eq(rule('2026-10-13T19:59:00'), 'evening/eod/2026-10-13', 'Tue 19:59');
  eq(rule('2026-10-14T08:40:00'), 'morning/intraday/2026-10-14', 'Wed 08:40');
  eq(rule('2026-10-14T06:00:00'), 'evening/eod/2026-10-13', 'Wed 06:00');
  eq(rule('2026-10-17T10:00:00'), 'morning/intraday/2026-10-16', 'Sat 10:00 (Friday morning)');
});

// ---------------------------------------------------------------- reading
await test('reads all 5 markets exactly; trading tab untouched; symbol + hidden indicator restored', async () => {
  const trade = makeTab({ id: 'TRADE1', name: 'Trading', menthorq: false }), lv = makeTab({ visible: { intraday: false } });
  await withTV([trade, lv], async tv => {
    const res = await R.readAll(cfgFor(tv.port), quiet);
    for (const t of R.TICKERS) eq(res[t].string, expectedString(t), `${t} string`);
    eq(R.problemsWith(res, cfgFor(tv.port)), [], 'no problems');
    eq(trade.st.setSymbolCalls.length, 0, 'trading tab symbol changes');
    eq(lv.st.symbol, SYMBOLS.NQ, 'levels tab back on NQ');
    eq(lv.st.visible.intraday, false, 'intraday hidden again');
    eq(res.NQ.eod.stamp.text, '2026-10-14 19:21', 'stamp read (timestamp box shares cells with the table)');
  });
});

await test('without "layout" it picks the one tab that has MenthorQ', async () => {
  const trade = makeTab({ id: 'TRADE1', menthorq: false }), lv = makeTab();
  await withTV([trade, lv], async tv => {
    const res = await R.readAll(cfgFor(tv.port, { layout: '' }), quiet);
    eq(res.GC.string, expectedString('GC'), 'GC');
    eq(trade.st.setSymbolCalls.length, 0, 'trading tab untouched');
  });
});

await test('slow redraw: waits for the new market instead of re-reading the old one', async () => {
  await withTV([makeTab({ lagMs: 1200 })], async tv => {
    const res = await R.readAll(cfgFor(tv.port), quiet);
    for (const t of R.TICKERS) eq(res[t].string, expectedString(t), `${t} string`);
  });
});

await test('stuck chart: ES never redraws, so nothing is posted', async () => {
  await withTV([makeTab({ stuck: ['ES'] })], async tv => {
    const cfg = cfgFor(tv.port), before = levelPosts().length;
    let err;
    try { await R.postLevels(cfg, { log: quiet }); } catch (e) { err = e; }
    assert(err instanceof R.RefusedError && err.problems.some(p => p.startsWith('ES:')), String(err?.message));
    eq(levelPosts().length, before, 'level posts');
  });
});

await test('"No Levels for this Ticker" on SILVER blocks the post with a clear reason', async () => {
  await withTV([makeTab({ noLevels: ['SILVER'] })], async tv => {
    let err;
    try { await R.postLevels(cfgFor(tv.port), { log: quiet }); } catch (e) { err = e; }
    assert(err?.problems?.some(p => /SILVER.*No Levels/.test(p)), String(err?.message));
  });
});

await test('frozen session: refuses before switching anything', async () => {
  const lv = makeTab({ frozen: true });
  await withTV([lv], async tv => {
    let err;
    try { await R.readAll(cfgFor(tv.port), quiet); } catch (e) { err = e; }
    assert(err instanceof R.FrozenError, String(err?.message));
    eq(lv.st.setSymbolCalls.length, 0, 'symbol changes');
  });
});

await test('TradingView stops answering: times out instead of hanging', async () => {
  await withTV([makeTab({ hang: true })], async tv => {
    const t0 = Date.now();
    let err;
    try { await R.readAll(cfgFor(tv.port), quiet); } catch (e) { err = e; }
    assert(/didn't answer/.test(err?.message), String(err?.message));
    assert(Date.now() - t0 < 8000, `took ${Date.now() - t0}ms`);
  });
});

// ---------------------------------------------------------------- posting
await test('stale levels are refused; --force posts them; the same levels are never posted twice', async () => {
  await withTV([makeTab({ stamps: { intraday: '2026-10-13 16:45 EST' } })], async tv => {
    const cfg = cfgFor(tv.port), rule = { wait_for: 'intraday', date: '2026-10-14' };
    let err;
    try { await R.postLevels(cfg, { rule, log: quiet }); } catch (e) { err = e; }
    assert(err?.problems?.some(p => /not today's/.test(p)), String(err?.message));
    const before = levelPosts().length;
    const { stamps } = await R.postLevels(cfg, { rule, force: true, log: quiet });
    eq(levelPosts().length, before + 1, 'posted once');
    const body = levelPosts().at(-1).body.content;
    eq((body.match(/```/g) || []).length, 10, 'five code blocks');
    assert(body.includes(expectedString('OIL')), 'OIL string in post');
    try { await R.postLevels(cfg, { state: { last_posted: { stamps, at: 'x' } }, log: quiet }); err = null; } catch (e) { err = e; }
    assert(err?.problems?.some(p => /already posted/.test(p)), 'duplicate refused');
  });
});

// ---------------------------------------------------------------- the watcher, one simulated day
await test('watcher, auto_update off: stale → reminder → update click → one post → missed-window notice', async () => {
  const lv = makeTab({ stamps: { eod: '2026-10-13 22:27', intraday: '2026-10-13 16:45 EST' } });
  await withTV([lv], async tv => {
    const cfg = cfgFor(tv.port, { auto_update: false });
    const st = { windows: {} };
    const at = async s => { R.sys.now = () => et(s); return R.watchTick(cfg, st, quiet); };
    const lp = levelPosts().length, mp = modlogPosts().length;
    calls.notify = [];

    await at('2026-10-14T07:50:00');   // yesterday's intraday on the chart: wait
    eq(levelPosts().length, lp, 'no post at 07:50');
    lv.st.latestVersion.intraday = '8.0';   // MenthorQ published 08:00's levels
    await at('2026-10-14T08:25:00');
    eq(calls.notify.length, 1, 'one "click update" reminder');
    assert(/purple/.test(calls.notify[0]), calls.notify[0]);
    await at('2026-10-14T08:27:00');
    eq(calls.notify.length, 1, 'reminder not repeated');

    lv.st.stamps.intraday = '2026-10-14 08:00 EST'; lv.st.chartVersion.intraday = '8.0';   // someone clicks update
    await at('2026-10-14T08:31:00');
    eq(levelPosts().length, lp + 1, 'posted once fresh');
    assert(st.windows['2026-10-14 morning'].posted, 'window marked posted');
    lv.st.stamps.intraday = '2026-10-14 09:00 EST';
    await at('2026-10-14T09:01:00');
    eq(levelPosts().length, lp + 1, 'no second morning post');

    lv.st.frozen = true;   // evening: this computer lost the live session all evening
    await at('2026-10-14T19:30:00');
    await at('2026-10-14T21:00:00');
    eq(modlogPosts().length, mp, 'frozen is quiet while the window is open');
    await at('2026-10-14T23:35:00');
    eq(modlogPosts().length, mp + 1, 'one missed-window notice after it closes');
    assert(/no evening levels.*disconnected/.test(modlogPosts().at(-1).body.content), modlogPosts().at(-1).body.content);
    assert(levelPosts().every(p => !/levels-relay:/.test(p.body.content)), 'no notices in the levels channel');
  });
});

await test('watcher, auto_update on: loads the new MenthorQ version by itself and posts (no click)', async () => {
  const lv = makeTab({ stamps: { eod: '2026-10-13 22:27', intraday: '2026-10-13 16:45 EST' }, publishedStamps: { intraday: '2026-10-14 08:00 EST' } });
  await withTV([lv], async tv => {
    const cfg = cfgFor(tv.port), st = { windows: {} }, lp = levelPosts().length;
    calls.notify = [];
    R.sys.now = () => et('2026-10-14T07:50:00'); await R.watchTick(cfg, st, quiet);
    eq([levelPosts().length, lv.st.inserted], [lp, 0], 'nothing new published yet: no post, no update');
    lv.st.latestVersion.intraday = '8.0';   // MenthorQ publishes the 08:00 levels
    R.sys.now = () => et('2026-10-14T08:05:00'); await R.watchTick(cfg, st, quiet);
    eq(levelPosts().length, lp + 1, 'posted in the same pass');
    const intra = lv.st.instances.filter(i => i.kind === 'intraday');
    eq([intra.length, intra[0].version, lv.st.saves >= 1], [1, '8.0', true], 'one Intraday indicator, on 8.0, layout saved');
    assert(calls.notify.length === 1 && /posted/.test(calls.notify[0]), `notifications: ${calls.notify}`);
  });
});

await test('watcher, auto_update fails safely: no timestamp on the new version → old kept, no duplicate, one note, reminder', async () => {
  const lv = makeTab({ stamps: { intraday: '2026-10-13 16:45 EST' }, latestVersion: { intraday: '8.0' }, noStampOnInsert: true });
  await withTV([lv], async tv => {
    const cfg = cfgFor(tv.port, { settle_seconds: 4 }), st = { windows: {} }, mp = modlogPosts().length, lp = levelPosts().length;
    calls.notify = [];
    R.sys.now = () => et('2026-10-14T08:05:00'); await R.watchTick(cfg, st, quiet);
    eq(lv.st.instances.map(i => i.id), ['st_eod', 'st_intraday'], 'only the original indicators remain');
    eq([modlogPosts().length, levelPosts().length], [mp + 1, lp], 'one #modlog note, no levels post');
    assert(/no "Last Update" time/.test(modlogPosts().at(-1).body.content), modlogPosts().at(-1).body.content);
    R.sys.now = () => et('2026-10-14T08:25:00'); await R.watchTick(cfg, st, quiet);
    R.sys.now = () => et('2026-10-14T08:27:00'); await R.watchTick(cfg, st, quiet);
    eq([lv.st.inserted, modlogPosts().length], [1, mp + 1], 'not retried, note not repeated');
    assert(calls.notify.length === 1 && /purple/.test(calls.notify[0]), `reminder: ${calls.notify}`);
  });
});

await test('watcher, auto_update with no free indicator slot: old kept, note says why', async () => {
  const lv = makeTab({ stamps: { intraday: '2026-10-13 16:45 EST' }, latestVersion: { intraday: '8.0' }, slotsFull: true });
  await withTV([lv], async tv => {
    const cfg = cfgFor(tv.port), st = { windows: {} }, mp = modlogPosts().length;
    R.sys.now = () => et('2026-10-14T08:05:00'); await R.watchTick(cfg, st, quiet);
    eq(lv.st.instances.length, 2, 'indicators unchanged');
    assert(modlogPosts().length === mp + 1 && /free indicator slot/.test(modlogPosts().at(-1).body.content), 'note mentions the slot');
  });
});

await test('watcher: a failed post retries with backoff and reports once to #modlog', async () => {
  const lv = makeTab({ stuck: ['GC'], stamps: { intraday: '2026-10-14 08:00 EST' } });
  await withTV([lv], async tv => {
    const cfg = cfgFor(tv.port), st = { windows: {} }, mp = modlogPosts().length;
    R.sys.now = () => et('2026-10-14T08:10:00'); await R.watchTick(cfg, st, quiet);
    R.sys.now = () => et('2026-10-14T08:12:00'); await R.watchTick(cfg, st, quiet);   // inside the 5-minute backoff: skipped
    const ws = st.windows['2026-10-14 morning'];
    eq([ws.attempts, ws.posted || false], [1, false], 'one attempt, not posted');
    eq(modlogPosts().length, mp + 1, 'reported once');
    assert(/GC/.test(modlogPosts().at(-1).body.content), 'reason names GC');
  });
});

await test('watcher: never starts or restarts TradingView unless config allows it', async () => {
  const tv = await startMockTV([]);
  const closedPort = tv.port;
  await tv.close();
  const st = { windows: {} };
  R.sys.now = () => et('2026-10-14T08:10:00');
  calls.launch = 0; calls.quit = 0;
  await R.watchTick(cfgFor(closedPort), st, quiet);
  eq([calls.launch, calls.quit], [0, 0], 'default: hands off');
  eq(st.windows['2026-10-14 morning'].lastState, 'closed', 'noted as closed');
  await R.watchTick(cfgFor(closedPort, { start_tradingview: true }), { windows: {} }, quiet);
  eq(calls.launch, 1, 'start_tradingview: launches');
});

console.log(failed ? `\n${failed} of ${n} test(s) failed.` : `\nAll ${n} tests passed.`);
process.exit(failed ? 1 : 0);
