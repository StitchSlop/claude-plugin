/**
 * The paths a PLUGIN adds on top of the wire protocol: lazy binding, `pair`,
 * following another bridge, taking over when it dies, two tabs, the shell CLI.
 *
 * The protocol itself is the app repo's job to check:
 *   node <app>/scripts/conformance-bridge.mjs -- node bridge/stitchslop-bridge.mjs
 *
 * Plays both peers — a browser tab on the WebSocket, an MCP client on stdio —
 * on ports 8797-8798 and a temp config dir, so a real bridge is never touched.
 * Tests behaviour, never the log.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tab as dial, TOOLS, answer, PNG } from './fake-tab.mjs';

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bridge', 'stitchslop-bridge.mjs');
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), 'stitchslop-plugin-'));
const ORIGIN = 'http://localhost:9999';
const PORTS = '8797,8798';

let bad = 0, checks = 0;
const ok = (label, cond, detail = '') => { checks++; if (!cond) bad++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`); };
const tab = (port) => dial(port, ORIGIN);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const portOpen = (port) => new Promise((res) => {
  const s = net.connect({ port, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

/* --------------------------------------------------------- an MCP client -- */
function mcp(extraArgs = [], env = {}) {
  const proc = spawn('node', [BRIDGE, '--origin', ORIGIN, '--config-dir', CFG, '--port', PORTS, ...extraArgs],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  const inbox = [], notes = [], junk = [];
  let out = '', id = 0;
  proc.stderr.on('data', () => {});
  proc.stdout.on('data', (c) => {
    out += c;
    for (let nl; (nl = out.indexOf('\n')) >= 0;) {
      const line = out.slice(0, nl).trim(); out = out.slice(nl + 1);
      if (!line) continue;
      try { const m = JSON.parse(line); (m.id === undefined ? notes : inbox).push(m); } catch { junk.push(line); }
    }
  });
  const replyTo = async (mine, ms) => {
    for (const until = Date.now() + ms; Date.now() < until; await wait(30)) {
      const hit = inbox.find((m) => m.id === mine);
      if (hit) return hit;
    }
    return null;
  };
  const request = (method, params, ms = 20_000) => {
    const mine = ++id;
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: mine, method, params }) + '\n');
    return replyTo(mine, ms);
  };
  /** Several tools/calls in ONE write, so they reach the bridge in one chunk
   *  and are dispatched in the same tick — the shape of a model's parallel calls
   *  arriving at a process that is busy. */
  const callTogether = (calls, ms = 30_000) => {
    const ids = calls.map(() => ++id);
    proc.stdin.write(calls.map(([name, args], i) =>
      JSON.stringify({ jsonrpc: '2.0', id: ids[i], method: 'tools/call', params: { name, arguments: args } }) + '\n').join(''));
    return ids.map((mine) => replyTo(mine, ms));
  };
  return {
    callTogether,
    proc, notes, junk,
    async init() {
      await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    },
    call: (name, args = {}, ms) => request('tools/call', { name, arguments: args }, ms),
    tools: async () => ((await request('tools/list'))?.result?.tools ?? []).map((t) => t.name),
  };
}
const textOf = (r) => (r?.result?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
// Async on purpose: the fake tab lives in this process, and spawnSync would
// stop it answering the very call being made.
const cli = (...args) => new Promise((resolve) => {
  const p = spawn('node', [BRIDGE, '--config-dir', CFG, ...args]);
  let stdout = '';
  p.stdout.on('data', (c) => { stdout += c; });
  p.stderr.on('data', () => {});
  p.on('close', (status) => resolve({ status, stdout }));
});

/* ================================== lazy ================================== */
console.log('lazy start');
const a = mcp(['--lazy']);
await a.init();
await wait(400);
ok('a lazy bridge with no credential stays alive', a.proc.exitCode === null);
ok('  ...and listens on nothing until asked', !(await portOpen(8797)) && !(await portOpen(8798)));
ok('  ...offering only its own tools', (await a.tools()).join() === 'wait_for_connection,pair,connection_status');
const st0 = JSON.parse(textOf(await a.call('connection_status')));
ok('connection_status opens nothing', st0.mode === 'idle' && !(await portOpen(8797)), st0.mode);

/* ================================== pair ================================== */
console.log('\npair');
const evil = await a.call('pair', { token: 'tok_aaaaaaaaaaaa', origin: 'https://evil.example' });
ok('pair refuses an origin that is neither production nor loopback', evil?.result?.isError === true && !(await portOpen(8797)));

// In PARALLEL, as a model will: both calls reach ensureTransport while the
// bridge is still idle, and only one of them may bind.
const [parallelWait, pairing] = a.callTogether([
  ['wait_for_connection', { timeoutSeconds: 20 }],
  ['pair', { token: 'tok_feedfacecafe.', origin: ORIGIN + '/', timeoutSeconds: 20 }],
]);
await wait(600);
ok('pair opens the bridge', await portOpen(8797));
ok('  ...and a parallel wait_for_connection does not open a second port', !(await portOpen(8798)));
const t1 = await tab(8797);
t1.send({ token: 'tok_feedfacecafe' });
const hello = await t1.next();
ok('the tab attaches with the token handed to pair', hello?.hello === 'stitchslop-connector' && typeof hello.pairingSecret === 'string',
  JSON.stringify(hello ?? {}).slice(0, 60));
t1.serve(TOOLS, answer);
const paired = await pairing;
ok('pair returns the design, not just "connected"', /1,234 stitches/.test(textOf(paired)) && /Leaf/.test(textOf(paired)), textOf(paired).slice(0, 50));
ok('  ...and says the token was spent, rather than leaving it to a guess', /token, which is now spent/.test(textOf(paired)));
ok('the parallel wait returns too', /1,234/.test(textOf(await parallelWait)));
await wait(200);
ok('the tab\'s tools are listed', (await a.tools()).includes('scene.render'));

const render = await a.call('scene.render');
const blocks = render?.result?.content ?? [];
ok('a dataUrl becomes an image block', blocks.some((b) => b.type === 'image' && b.data === PNG && b.mimeType === 'image/png'));
ok('  ...and leaves the text', !textOf(render).includes(PNG) && /Rendered\./.test(textOf(render)));
ok('  ...and the transport id never reaches the model', !/"id"/.test(textOf(render)));
const refused = await a.call('object.draw');
ok('a refusal is isError carrying the app\'s sentence', refused?.result?.isError === true && /closed shape/.test(textOf(refused)));

/* =============================== two tabs ================================= */
console.log('\ntwo tabs');
const t2 = await tab(8797);
t2.send({ secret: hello.pairingSecret });
const busy = await t2.next();
ok('a second tab is refused as busy, not switched to', busy?.busy === true && busy?.error === 'busy', JSON.stringify(busy ?? {}).slice(0, 50));
ok('  ...and the first tab still answers', /1,234/.test(textOf(await a.call('scene.describe'))));

/* =============================== following ================================ */
console.log('\na second session follows the first');
const b = mcp(['--lazy']);
await b.init();
const bWait = await b.call('wait_for_connection', { timeoutSeconds: 10 });
ok('it reaches the same tab', /already connected/.test(textOf(bWait)) && /1,234/.test(textOf(bWait)), textOf(bWait).slice(0, 40));
ok('  ...without opening a second port', !(await portOpen(8798)));
ok('  ...and lists the tab\'s tools', (await b.tools()).includes('scene.describe'));
ok('  ...and its calls go through', /Rendered/.test(textOf(await b.call('scene.render'))));
const bStatus = JSON.parse(textOf(await b.call('connection_status')));
ok('  ...and says it is sharing', bStatus.mode === 'follower' && bStatus.port === 8797, JSON.stringify(bStatus).slice(0, 70));

/* ================================ the CLI ================================= */
console.log('\nthe shell CLI');
const s1 = await cli('status');
ok('status: JSON on stdout, exit 0', s1.status === 0 && JSON.parse(s1.stdout).connected === true);
const c1 = await cli('call', 'object.draw', '{"shape":"rect"}');
ok('a refusal exits 1 with the envelope on stdout', c1.status === 1 && JSON.parse(c1.stdout).error === 'refused');
const shot = path.join(CFG, 'shot.png');
const c2 = await cli('call', 'scene.render', '--out', shot);
const env2 = JSON.parse(c2.stdout || '{}');
ok('--out writes the picture and replaces dataUrl', c2.status === 0 && fs.existsSync(shot) && !env2.dataUrl && env2.savedTo === shot && env2.savedType === 'image/png');
ok('bad JSON args exit 64', (await cli('call', 'scene.describe', '{nope')).status === 64);

const session = JSON.parse(fs.readFileSync(path.join(CFG, 'session-8797.json'), 'utf8'));
ok('the session file is owner-only', (fs.statSync(path.join(CFG, 'session-8797.json')).mode & 0o777) === 0o600);
const asPage = await fetch('http://127.0.0.1:8797/status', { headers: { 'x-stitchslop-key': session.key, origin: ORIGIN } });
ok('the control plane refuses anything carrying an Origin, right key or not', asPage.status === 403);
const noKey = await fetch('http://127.0.0.1:8797/status');
ok('  ...and anything without the key', noKey.status === 401);

/* =============================== taking over ============================== */
console.log('\nthe host session ends');
a.proc.stdin.end();
for (let i = 0; i < 40 && a.proc.exitCode === null; i++) await wait(100);
ok('a bridge owned by an MCP client exits with it', a.proc.exitCode === 0, `exit ${a.proc.exitCode}`);
ok('  ...and removes its own session file', !fs.existsSync(path.join(CFG, 'session-8797.json')));
let took = false;
for (let i = 0; i < 60 && !took; i++) { await wait(200); took = b.proc.exitCode === null && fs.existsSync(path.join(CFG, 'session-8797.json')); }
ok('the follower takes the port over', took);
const t3 = await tab(8797);
t3.send?.({ secret: hello.pairingSecret });
const hello3 = await t3.next?.();
ok('  ...and the returning tab attaches with its stored pairing', hello3?.hello === 'stitchslop-connector' && hello3.pairingSecret === undefined);
t3.serve?.(TOOLS, answer);
await wait(300);
ok('  ...and work carries on', /1,234/.test(textOf(await b.call('scene.describe'))));
ok('  ...with list_changed sent each time the tools came and went', b.notes.filter((n) => n.method === 'notifications/tools/list_changed').length >= 3,
  String(b.notes.length));

/* ============================== a second tab ============================== */
console.log('\nownBridge');
const c = mcp(['--lazy']);
await c.init();
const cWait = c.call('wait_for_connection', { ownBridge: true, timeoutSeconds: 10 }, 20_000);
await wait(600);
ok('ownBridge opens the next port instead of following', await portOpen(8798));
const t4 = await tab(8798);
t4.send?.({ secret: hello.pairingSecret });
ok('  ...where the turned-away tab finds it', (await t4.next?.())?.port === 8798);
t4.serve?.(TOOLS, answer);
const cText = textOf(await cWait);
ok('  ...and the parked wait returns', /1,234/.test(cText));
ok('  ...saying the stored pairing got it in, with no token', /stored pairing, so no token was needed/.test(cText));

ok('stdout stayed pure JSON-RPC in every bridge', a.junk.length + b.junk.length + c.junk.length === 0);

for (const m of [a, b, c]) { try { m.proc.kill(); } catch {} }
for (const t of [t1, t2, t3, t4]) { try { t.close?.(); } catch {} }
await wait(200);
fs.rmSync(CFG, { recursive: true, force: true });
console.log(`\n${bad ? `FAILED — ${bad} of ${checks}` : `all ${checks} checks passed`}`);
process.exit(bad ? 1 : 0);
