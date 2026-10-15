// A fake TradingView Desktop for tests: the same debug endpoints (/json/list and a
// DevTools WebSocket per tab), with chart tabs that draw MenthorQ-style output the
// way a real MenthorQ chart shows it: a "Key Levels" table, a "Last Update" box, and one
// labeled line per level. The numbers are made up, so no MenthorQ data is shipped.
//
// Each tab can misbehave on purpose: redraw late, never redraw, show "No Levels",
// freeze ("Session disconnected") or stop answering.
import http from 'node:http';
import crypto from 'node:crypto';
import vm from 'node:vm';

export const PRICES = { NQ: 30600, ES: 7860, GC: 4180, OIL: 92, SILVER: 59 };
const STEPS = { NQ: 50, ES: 10, GC: 5, OIL: 0.5, SILVER: 0.25 };
export const SYMBOLS = { NQ: 'CME_MINI:NQ1!', ES: 'CME_MINI:ES1!', GC: 'COMEX:GC1!', OIL: 'NYMEX:CL1!', SILVER: 'COMEX:SI1!' };
const ROOT_TO_T = Object.fromEntries(Object.entries(SYMBOLS).map(([t, s]) => [s.split(':').pop(), t]));
const NAMES = ['GEX 1', 'GEX 2', 'GEX 3', 'GEX 4', 'GEX 5', 'GEX 6', 'GEX 7', 'GEX 8', 'GEX 9', 'GEX 10', 'Call Resistance',
  'Call Resistance 0DTE', 'Put Support', 'Put Support 0DTE', 'HVL', 'HVL 0DTE', 'Gamma Wall 0DTE', '1D Max', '1D Min'];

// 19 levels for a market and session, in the indicator's order.
export function levels(t, kind) {
  const p = PRICES[t], s = STEPS[t], k = kind === 'eod' ? 0 : 1;
  const r = x => +(Math.round(x / s) * s).toFixed(4);
  const gex = [1, -1, 2, -2, 3 + k, -3, 4, -4 - k, 6, -6].map(m => r(p + m * s));
  return [...gex, r(p + 8 * s), r(p + 5 * s), r(p - 8 * s), r(p - 5 * s - k * s), r(p + 0.5 * s), r(p + 0.5 * s), r(p + 5 * s),
    +(p * 1.0175).toFixed(2), +(p * 0.9825).toFixed(2)];
}
export const expectedString = t => levels(t, 'eod').concat(levels(t, 'intraday')).join(',');

function draw(t, kind, stamp) {
  const vals = levels(t, kind);
  const byPrice = new Map();
  vals.forEach((v, i) => byPrice.set(v, [...(byPrice.get(v) || []), NAMES[i]]));
  const labels = [...byPrice].map(([y, n]) => ({ t: n.join(' / '), y }));
  const lines = [...byPrice.keys()].map(y => ({ y1: y, y2: y }));
  const rows = [...byPrice].sort((a, b) => b[0] - a[0]).map(([y, n]) => [n.join(' / '), String(y), `${(((y / PRICES[t]) - 1) * 100).toFixed(2)}%`]);
  const cells = [['Key Levels', 'Value', 'Distance to Spot'], ...rows].flatMap((row, r) => row.map((tx, c) => ({ t: tx, row: r, col: c })));
  // the timestamp box, sharing row/col numbers with the table (no table id), the worst case
  if (stamp) cells.push({ t: `${kind === 'eod' ? 'End of Day Levels' : 'Intraday Levels'}\nLast Update: ${stamp}`, row: 1, col: 0 });
  return { labels, lines, cells };
}

const coll = arr => ({ get: () => ({ get: () => ({ _primitivesDataById: new Map(arr.map((v, i) => [i, v])) }) }) });

export function makeTab(opts = {}) {
  const st = {
    id: opts.id || 'LEVELS1', name: opts.name || 'levels-relay', symbol: opts.symbol || SYMBOLS.NQ, drawn: null,
    menthorq: opts.menthorq !== false, visible: { eod: true, intraday: true, ...(opts.visible || {}) },
    stamps: { eod: '2026-10-14 19:21', intraday: '2026-10-14 16:45 EST', ...(opts.stamps || {}) },
    chartVersion: { eod: '7.0', intraday: '7.0', ...(opts.chartVersion || {}) },
    latestVersion: { eod: '7.0', intraday: '7.0', ...(opts.latestVersion || {}) },
    lagMs: opts.lagMs || 0, stuck: new Set(opts.stuck || []), noLevels: new Set(opts.noLevels || []),
    frozen: !!opts.frozen, hang: !!opts.hang, hidden: !!opts.hidden, setSymbolCalls: [],
  };
  st.drawn = st.symbol.split(':').pop();
  const study = kind => {
    const desc = kind === 'eod' ? 'MenthorQ Gamma Levels EOD' : 'MenthorQ Gamma Levels Intraday';
    return {
      metaInfo: () => ({ description: desc, scriptIdPart: `PUB;mq${kind}`, pine: { version: st.chartVersion[kind] } }),
      title: () => desc, id: () => `st_${kind}`,
      properties: () => ({ visible: { value: () => st.visible[kind], setValue: v => { st.visible[kind] = v; } } }),
      get _graphics() {
        const t = ROOT_TO_T[st.drawn];
        if (!st.visible[kind] || !t) return { _primitivesCollection: { dwglabels: coll([]), dwglines: coll([]), dwgtablecells: coll([]) } };
        if (st.noLevels.has(t)) return { _primitivesCollection: { dwglabels: coll([{ t: 'No Levels for this Ticker', y: PRICES[t] }]), dwglines: coll([]), dwgtablecells: coll([]) } };
        const d = draw(t, kind, st.stamps[kind]);
        return { _primitivesCollection: { dwglabels: coll(d.labels), dwglines: coll(d.lines), dwgtablecells: coll(d.cells) } };
      },
    };
  };
  const volume = { metaInfo: () => ({ description: 'Volume' }), title: () => 'Volume', id: () => 'vol', properties: () => ({ visible: { value: () => true } }) };
  const sources = () => [volume, ...(st.menthorq ? [study('eod'), study('intraday')] : [])];
  const chart = {
    symbol: () => st.symbol,
    setSymbol: sym => {
      st.symbol = sym; st.setSymbolCalls.push(sym);
      const root = sym.split(':').pop();
      if (!st.stuck.has(ROOT_TO_T[root])) setTimeout(() => { st.drawn = root; }, st.lagMs);
    },
    getStudyById: id => ({ setVisible: v => { st.visible[id.replace('st_', '')] = v; } }),
    _chartWidget: { model: () => ({
      mainSeries: () => ({ bars: () => ({ last: () => ({ value: [0, 0, 0, 0, PRICES[ROOT_TO_T[st.symbol.split(':').pop()]] ?? null] }) }) }),
      model: () => ({ dataSources: sources }) }) },
  };
  const ctx = vm.createContext({
    document: { get body() { return { innerText: st.frozen ? 'Session disconnected\nConnect' : 'chart' }; }, get visibilityState() { return st.hidden ? 'hidden' : 'visible'; } },
    fetch: async url => {
      const kind = /mqeod/.test(decodeURIComponent(url)) ? 'eod' : 'intraday';
      return { ok: true, json: async () => [{ version: st.latestVersion[kind], created: '2026-10-15T12:01:00Z' }] };
    },
  });
  ctx.window = ctx;
  ctx.TradingViewApi = { _activeChartWidgetWV: { value: () => chart }, layoutId: () => st.id, layoutName: () => st.name };
  return { st, ctx };
}

function frame(str) {
  const p = Buffer.from(str);
  const head = p.length < 126 ? Buffer.from([0x81, p.length])
    : p.length < 65536 ? Buffer.from([0x81, 126, p.length >> 8, p.length & 255])
    : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(p.length)); return b; })()]);
  return Buffer.concat([head, p]);
}

function parseFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 15, masked = buf[1] & 128;
  let len = buf[1] & 127, off = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); off = 10; }
  let mask = null;
  if (masked) { if (buf.length < off + 4) return null; mask = buf.subarray(off, off + 4); off += 4; }
  if (buf.length < off + len) return null;
  const payload = Buffer.from(buf.subarray(off, off + len));
  if (mask) for (let i = 0; i < len; i++) payload[i] ^= mask[i % 4];
  return { opcode, payload, size: off + len };
}

// tabs: array of makeTab() results. Returns { port, close }.
export async function startMockTV(tabs) {
  const server = http.createServer((req, res) => {
    if (req.url === '/json/list') {
      const port = server.address().port;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(tabs.map((tab, i) => ({ type: 'page', url: `https://www.tradingview.com/chart/${tab.st.id}/`,
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${i}` }))));
    } else { res.statusCode = 404; res.end(); }
  });
  const sockets = new Set();
  server.on('upgrade', (req, socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    const tab = tabs[Number(req.url.split('/').pop())];
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let buf = Buffer.alloc(0);
    socket.on('data', async d => {
      buf = Buffer.concat([buf, d]);
      for (let f; (f = parseFrame(buf));) {
        buf = buf.subarray(f.size);
        if (f.opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
        if (f.opcode !== 1) continue;
        const msg = JSON.parse(f.payload.toString());
        if (tab.st.hang) continue;
        let reply;
        try {
          const value = await vm.runInContext(msg.params.expression, tab.ctx);
          reply = { id: msg.id, result: { result: { type: typeof value, value: value === undefined ? undefined : JSON.parse(JSON.stringify(value)) } } };
        } catch (e) {
          reply = { id: msg.id, result: { exceptionDetails: { exception: { description: String(e) } } } };
        }
        if (!socket.destroyed) socket.write(frame(JSON.stringify(reply)));
      }
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, close: () => new Promise(r => { sockets.forEach(s => s.destroy()); server.close(r); }) };
}
