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
import crypto from 'node:crypto';
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
const tab = (port, origin = ORIGIN) => dial(port, origin);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const portOpen = (port) => new Promise((res) => {
  const s = net.connect({ port, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});

/* --------------------------------------------------------- an MCP client -- */
/** `origin: null` launches with NO --origin, as the plugin's .mcp.json does —
 *  so the bridge starts on production. */
function mcp(extraArgs = [], env = {}, { origin = ORIGIN } = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.STITCHSLOP_ORIGIN;
  const proc = spawn('node', [BRIDGE, ...(origin ? ['--origin', origin] : []), '--config-dir', CFG, '--port', PORTS, ...extraArgs],
    { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv });
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
ok('  ...offering only its own tools', (await a.tools()).join() === 'wait_for_connection,pair,connection_status,call_with_file');
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
  // Both values as a sentence might leave them: trailing punctuation, a slash.
  ['pair', { token: 'tok_feedfacecafe.', origin: ORIGIN + '/.', timeoutSeconds: 20 }],
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
ok('  ...and says nothing about listening, since this tab offers no voice.listen', !/ listen --port/.test(textOf(paired)));
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

/* ============================ call_with_file ============================== */
console.log('\ncall_with_file');
const pngFile = path.join(CFG, 'logo.png');
fs.writeFileSync(pngFile, Buffer.from(PNG, 'base64'));
const attached = await a.call('call_with_file', { command: 'background.set', args: { opacity: 0.5 }, fileArg: 'image', path: pngFile });
const attachedText = textOf(attached);
ok('an image reaches the tab as a data URL under the named argument',
  attached?.result?.isError === false && /"received": "data:image\/png;base64,"/.test(attachedText), attachedText.slice(0, 90));
ok('  ...alongside the other arguments', /"opacity": 0\.5/.test(attachedText));
ok('  ...and the result says what was attached', /attached .*logo\.png, image\/png/.test(attachedText));
const notImage = path.join(CFG, 'notes.png');
fs.writeFileSync(notImage, 'secret notes, named like a picture');
const refusedFile = await a.call('call_with_file', { command: 'background.set', fileArg: 'image', path: notImage });
ok('a file that is not an image is refused by its bytes, whatever its name',
  refusedFile?.result?.isError === true && /not a PNG, JPEG, WebP or GIF/.test(textOf(refusedFile)));
ok('  ...and nothing is sent to the tab', !/secret notes/.test(textOf(refusedFile)) && !/received/.test(textOf(refusedFile)));
ok('call_with_file will not dress up the bridge\'s own tools',
  (await a.call('call_with_file', { command: 'pair', fileArg: 'token', path: pngFile }))?.result?.isError === true);

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
// 2MB — over the control plane's old 1MB body limit, which a follower's
// /call has to pass through. PNG signature, then padding.
const bigFile = path.join(CFG, 'big.png');
fs.writeFileSync(bigFile, Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(2_000_000, 7)]));
const big = await b.call('call_with_file', { command: 'background.set', fileArg: 'image', path: bigFile }, 30_000);
ok('  ...and a 2MB image goes through the shared bridge whole',
  big?.result?.isError === false && Number(/"receivedLength": (\d+)/.exec(textOf(big))?.[1]) > 2_600_000, textOf(big).slice(0, 80));
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
const c3 = await cli('call', 'background.set', '{"opacity":0.3}', '--file', `image=${pngFile}`);
const env3 = JSON.parse(c3.stdout || '{}');
ok('--file KEY=PATH attaches an image to the call', c3.status === 0 && env3.received?.startsWith('data:image/png;base64,') && env3.opacity === 0.3);
ok('  ...and refuses a non-image with a usage error, sending nothing', (await cli('call', 'background.set', '--file', `image=${notImage}`)).status === 64);
// A pipe holds 64KB and Node writes into one asynchronously, so exiting right
// after the write cut the reply at 65,536 bytes; `cli` reads through a pipe.
const bigReply = await cli('call', 'scene.describe', '{"big":true}');
let bigLen = null; try { bigLen = JSON.parse(bigReply.stdout).filler?.length ?? null; } catch {}
ok('a reply over 64KB arrives whole through a pipe', bigReply.status === 0 && bigLen === 200_000,
  `${bigReply.stdout.length} bytes, filler ${bigLen}`);

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

/* ================ a paired site that is not the bridge's own ============== */
// Field report, 2026-09-20: the plugin's bridge starts on PRODUCTION. A browser
// paired from localhost was refused at the upgrade, and only `pair` — with a new
// token — got past it, every single time.
console.log('\na paired site that is not the bridge\'s own');
for (const m of [b, c]) { m.proc.stdin.end(); }
for (const t of [t3, t4]) { try { t.close?.(); } catch {} }
for (let i = 0; i < 40 && (await portOpen(8797) || await portOpen(8798)); i++) await wait(100);

const d = mcp(['--lazy'], {}, { origin: null });
await d.init();
const d0 = JSON.parse(textOf(await d.call('connection_status')));
ok('status lists every paired site, not only the bridge\'s own', d0.origin === 'https://www.stitchslop.com'
  && d0.paired === false && d0.pairedOrigins?.includes(ORIGIN), JSON.stringify(d0.pairedOrigins));
const dWait = d.call('wait_for_connection', { timeoutSeconds: 20 }, 30_000);
await wait(600);
const t5 = await tab(8797);
ok('a tab from a PAIRED site is admitted at the upgrade', !t5.rejected, String(t5.rejected ?? ''));
t5.send?.({ secret: hello.pairingSecret });
const hello5 = await t5.next?.();
ok('  ...and attaches with its stored pairing, no token anywhere',
  hello5?.hello === 'stitchslop-connector' && hello5.pairingSecret === undefined, JSON.stringify(hello5 ?? {}).slice(0, 60));
t5.serve?.(TOOLS, answer);
const dText = textOf(await dWait);
ok('  ...so wait_for_connection alone connects it', /1,234/.test(dText) && /stored pairing/.test(dText), dText.slice(0, 60));
const d1 = JSON.parse(textOf(await d.call('connection_status')));
ok('  ...and the bridge now says it serves that site', d1.origin === ORIGIN && d1.paired === true, d1.origin);

const stranger = await tab(8797, 'http://localhost:7777');
ok('a loopback site with NO pairing is still refused at the upgrade', stranger.rejected === 403, String(stranger.rejected));
const forger = await tab(8797);
forger.send?.({ secret: 'not-the-secret' });
ok('a paired site with the WRONG secret is still refused', (await forger.next?.())?.error === 'bad_credential');

// A token is good only for the site it was issued by, even when the bridge
// admits two. Seed a second pairing, arm a token for the first, present it from
// the second.
const pf = path.join(CFG, 'pairing.json');
const pairings = JSON.parse(fs.readFileSync(pf, 'utf8'));
pairings['http://localhost:8888'] = { secret: 'seeded-secret-for-8888-0123456789abcdef' };
fs.writeFileSync(pf, JSON.stringify(pairings), { mode: 0o600 });
await d.call('pair', { token: 'tok_aaaaaaaaaaaa', origin: ORIGIN, timeoutSeconds: 5 });
const crossSite = await tab(8797, 'http://localhost:8888');
crossSite.send?.({ token: 'tok_aaaaaaaaaaaa' });
ok('a token armed for one site does not open the bridge to another', !crossSite.rejected
  && (await crossSite.next?.())?.error === 'bad_credential');

// The panel shows every one of those as "Waiting to connect", so the bridge
// is the only place anyone can read why. Each must be on record, by reason.
const dr = JSON.parse(textOf(await d.call('connection_status')));
const reasons = new Map((dr.recentRefusals ?? []).map((r) => [r.reason, r]));
ok('refusals are on record where an agent can read them: the unpaired site…',
  reasons.get('site')?.origin === 'http://localhost:7777', JSON.stringify(dr.recentRefusals ?? []).slice(0, 90));
// 8888 holds a pairing, so a bad credential from it is a wrong pairing too.
const refusedAt = (reason, origin) => (dr.recentRefusals ?? []).some((r) => r.reason === reason && r.origin === origin);
ok('  …the wrong secret, and the token from another site',
  refusedAt('wrong_pairing', ORIGIN) && refusedAt('wrong_pairing', 'http://localhost:8888'), JSON.stringify(dr.recentRefusals).slice(0, 200));
ok('  …with every attempt counted, refused or not', dr.connectionAttempts >= 4, String(dr.connectionAttempts));

const e = mcp(['--lazy'], {}, { origin: null });
await e.init();
const eText = textOf(await e.call('wait_for_connection', { origin: ORIGIN + '/', timeoutSeconds: 10 }));
ok('wait_for_connection with the line\'s origin shares the bridge serving it', /already connected/.test(eText) && /1,234/.test(eText)
  && !(await portOpen(8798)), eText.slice(0, 50));
const f = mcp(['--lazy'], {}, { origin: null });
await f.init();
const fText = textOf(await f.call('wait_for_connection', { origin: 'http://localhost:5555', timeoutSeconds: 5 }, 20_000));
ok('  ...and naming a DIFFERENT site does not borrow that tab', /Still waiting|not paired/.test(fText) && !/1,234/.test(fText), fText.slice(0, 50));
ok('a wait nobody dialled says the tab never tried, not that a credential failed',
  /saw no connection attempt at all/.test(fText) && !/being refused/.test(fText), fText.slice(0, 120));
const eStatus = JSON.parse(textOf(await e.call('connection_status')));
ok('a following session sees its host\'s refusals', (eStatus.recentRefusals ?? []).some((r) => r.reason === 'site'),
  JSON.stringify(eStatus.recentRefusals ?? []).slice(0, 60));
// A tab refused DURING a wait: the result must lead with that, since the
// user's panel only says "Waiting to connect".
const fWait2 = f.call('wait_for_connection', { timeoutSeconds: 6 }, 20_000);
await wait(800);
const knocker = await tab(8798, 'http://localhost:7777');
const fText2 = textOf(await fWait2);
ok('a wait during which the tab was refused leads with the refusal and its fix',
  knocker.rejected === 403 && /IS reaching this bridge and being refused/.test(fText2) && /localhost:7777/.test(fText2)
  && /click Copy/.test(fText2), fText2.slice(0, 140));
const fEvil = await f.call('wait_for_connection', { origin: 'https://evil.example' });
ok('  ...and an origin that is neither production nor loopback is refused', fEvil?.result?.isError === true);

/* ======== the app's one line, given to an ALREADY-PAIRED browser ======== */
// The app now shows the same line, token included, to every browser. For a
// paired one the tab sends its secret AND that token: the pairing must win and
// the token go unused — pairing again would churn a working credential.
console.log('\nthe line\'s token, for a browser that is already paired');
t5.close?.();
for (let i = 0; i < 40 && JSON.parse(textOf(await d.call('connection_status'))).connected; i++) await wait(100);
const g = mcp(['--lazy'], {}, { origin: null });
await g.init();
const gPair = g.call('pair', { token: 'tok_bbbbbbbbbbbb', origin: ORIGIN, timeoutSeconds: 15 }, 30_000);
await wait(1200);
const t6 = await tab(8797);
t6.send?.({ secret: hello.pairingSecret, token: 'tok_bbbbbbbbbbbb' });
const hello6 = await t6.next?.();
t6.serve?.(TOOLS, answer);
const gText = textOf(await gPair);
ok('pair with the line\'s token attaches a paired browser by its pairing', hello6?.hello === 'stitchslop-connector'
  && hello6.pairingSecret === undefined && /stored pairing, so no token was needed/.test(gText), gText.slice(0, 80));
const used = JSON.parse(fs.readFileSync(pf, 'utf8'))[ORIGIN]?.usedTokens ?? [];
ok('  ...and the token is left unspent', !used.includes(crypto.createHash('sha256').update('tok_bbbbbbbbbbbb').digest('hex').slice(0, 32)));

/* ============================= listen ===================================== */
// The app's handoff, 2026-09-20: speech waits in the tab's queue until someone
// calls voice.listen, and an agent that has ended its turn calls nothing.
// `listen` is a command a host watches; each line it prints wakes the agent.
console.log('\nlisten');
t6.close?.();
for (let i = 0; i < 40 && JSON.parse(textOf(await d.call('connection_status'))).connected; i++) await wait(100);

/** A tab that answers voice.listen from a script, in order (the last repeats);
 *  a step of 'drop' closes the socket instead of answering. */
async function scriptedTab(steps, { voiceSwitch = false } = {}) {
  const t = await tab(8797);
  t.send({ secret: hello.pairingSecret });
  const hi = await t.next();
  // An app with the voice switch documents `voiceOn` in voice.listen's description.
  const desc = voiceSwitch ? 'Hear what the user said. `voiceOn` says whether voice is switched on.' : 'Hear what the user said.';
  t.send({ tools: [...TOOLS, { name: 'voice.listen', description: desc, inputSchema: { type: 'object' } }] });
  (async () => {
    let i = 0;
    for (;;) {
      const m = await t.next(60_000);
      if (!m || m.closed) return;
      if (m.id == null || !m.command) continue;
      if (m.command !== 'voice.listen') { t.send({ ...answer(m), id: m.id }); continue; }
      const step = steps[Math.min(i++, steps.length - 1)];
      const r = typeof step === 'function' ? await step(m) : step;
      if (r === 'drop') { t.close(); return; }
      t.send({ ...r, id: m.id });
    }
  })();
  return { t, hi };
}
const SEL = [{ id: 'o_1', name: 'Square' }];
const quiet = async () => { await wait(1500); return { ok: true, heard: [], selection: SEL }; };
const t7 = await scriptedTab([
  async () => { await wait(300); return { ok: true, heard: [], selection: SEL }; },
  { ok: true, heard: [{ text: 'make that bigger', atMs: 1790000000001 }, { text: 'now blue', atMs: 1790000000002 }], selection: SEL },
  'drop',
]);
ok('a scripted tab attaches for the listen test', t7.hi?.hello === 'stitchslop-connector');
await wait(300);
// The connect result, not a skill paragraph, is where an agent learns to start
// it: a fresh session connected, summarised, ended its turn, and speech went
// nowhere (the app's follow-up handoff, 2026-09-20).
const beforeListen = textOf(await d.call('wait_for_connection', { timeoutSeconds: 5 }));
ok('connecting to a tab with voice.listen hands over the exact listen command, config dir included',
  /Once it is running — not before/.test(beforeListen) && beforeListen.includes(`node "${BRIDGE}" listen --port 8797 --config-dir "${fs.realpathSync(CFG)}"`) || beforeListen.includes(`node "${BRIDGE}" listen --port 8797 --config-dir "${CFG}"`) && /select:Monitor/.test(beforeListen), beforeListen.slice(-260));

// Run EXACTLY the command the connect result handed over, not one written
// here. A hand-written one hid a missing --config-dir.
const handed = /^\s*node (.+ listen .*)$/m.exec(beforeListen)?.[1] ?? '';
const handedArgs = [...handed.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
ok('the handed-over command parses into a script and its arguments', handedArgs[0] === BRIDGE && handedArgs[1] === 'listen', handed);
const listener = spawn('node', handedArgs);
// Watched from the start: a listen that dies at once must fail the test, not
// hang it waiting for a 'close' that already happened.
const listenExitP = new Promise((r) => listener.on('close', (code) => r(code)));
let heardOut = '';
listener.stdout.on('data', (c) => { heardOut += c; });
listener.stderr.on('data', () => {});
const lines = () => heardOut.split('\n').filter(Boolean);
for (let i = 0; i < 80 && !lines().some((l) => l.includes('disconnected')); i++) await wait(100);
const t8 = await scriptedTab([{ ok: true, heard: [{ text: 'and centre it', atMs: 1790000000003 }], selection: SEL }, quiet]);
for (let i = 0; i < 80 && lines().length < 5; i++) await wait(100);
await wait(500);                                   // anything extra would arrive now
const whileListening = textOf(await g.call('wait_for_connection', { timeoutSeconds: 5 }));
ok('while one runs, another session is told not to start a second',
  whileListening.includes(`already running for this tab (pid ${listener.pid})`) && !/start this NOW/.test(whileListening),
  whileListening.slice(-200));
ok('  ...and so is the session that owns the bridge',
  textOf(await d.call('wait_for_connection', { timeoutSeconds: 5 })).includes(`(pid ${listener.pid})`));
listener.kill('SIGTERM');
const listenExit = await listenExitP;
const expected = [
  { heard: 'make that bigger', atMs: 1790000000001, selection: SEL },
  { heard: 'now blue', atMs: 1790000000002, selection: SEL },
  { event: 'disconnected' },
  { event: 'connected' },
  { heard: 'and centre it', atMs: 1790000000003, selection: SEL },
];
ok('listen prints exactly: two utterances, disconnected, connected, one utterance',
  JSON.stringify(lines().map((l) => JSON.parse(l))) === JSON.stringify(expected), lines().join(' | ').slice(0, 200));
ok('  ...and SIGTERM ends it quietly, exit 0', listenExit === 0, String(listenExit));
ok('once it has stopped, connecting says to start one again',
  /start this NOW/.test(textOf(await d.call('wait_for_connection', { timeoutSeconds: 5 }))));

t8.t.close();
for (let i = 0; i < 40 && JSON.parse(textOf(await d.call('connection_status'))).connected; i++) await wait(100);
const t9 = await scriptedTab([{ ok: false, error: 'refused', changed: false,
  message: 'Voice input is not available in this editor.', say: 'Voice input is not available in this editor.' }]);
const refusedListen = await new Promise((resolve) => {
  const p = spawn('node', [BRIDGE, '--config-dir', CFG, 'listen', '--port', '8797']);
  let out = '';
  p.stdout.on('data', (c) => { out += c; });
  p.stderr.on('data', () => {});
  const kill = setTimeout(() => p.kill('SIGKILL'), 15_000);
  p.on('close', (code) => { clearTimeout(kill); resolve({ code, out }); });
});
ok('a refusal ends listen: one "unavailable" line with the app\'s sentence, exit 1', refusedListen.code === 1
  && refusedListen.out === JSON.stringify({ event: 'unavailable', message: 'Voice input is not available in this editor.' }) + '\n',
  refusedListen.out.slice(0, 100));
t9.t.close();
for (let i = 0; i < 40 && JSON.parse(textOf(await d.call('connection_status'))).connected; i++) await wait(100);

// The user's voice switch (the app's 036735f): off by default, `voiceOn` on
// every reply, and a wait that ends the moment they flip it.
const off = { ok: true, heard: [], voiceOn: false, selection: SEL, say: 'Voice is off.' };
const t10 = await scriptedTab([
  off, off,
  { ok: true, heard: [], voiceOn: true, selection: SEL, say: 'The user just switched voice on.' },
  { ok: true, heard: [{ text: 'make it red', atMs: 1790000000004 }], voiceOn: true, selection: SEL },
  { ok: true, heard: [], voiceOn: false, voiceSupport: 'browser', selection: SEL,
    say: 'Voice cannot work in this browser: it needs Google Chrome on a computer.' },
  async () => { await wait(1500); return off; },
], { voiceSwitch: true });
const switchAdvice = textOf(await d.call('wait_for_connection', { timeoutSeconds: 5 }));
ok('with a voice switch, the connect result says to greet on voice-on, not at once',
  /do not greet yet/.test(switchAdvice) && /"voice-on"/.test(switchAdvice) && !/Once it is running — not before/.test(switchAdvice),
  switchAdvice.slice(-220));
const vArgs = [...(/^\s*node (.+ listen .*)$/m.exec(switchAdvice)?.[1] ?? '').matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
const vl = spawn('node', vArgs);
const vExit = new Promise((r) => vl.on('close', (code) => r(code)));
let vOut = '';
vl.stdout.on('data', (c) => { vOut += c; });
vl.stderr.on('data', () => {});
for (let i = 0; i < 120 && vOut.split('\n').filter(Boolean).length < 4; i++) await wait(100);
await wait(2500);                                  // a repeat 'off' must print nothing
vl.kill('SIGTERM');
await vExit;
ok('listen reports the voice switch: off at first, on, what was said, off with the reason',
  vOut === [
    { event: 'voice-off' },
    { event: 'voice-on' },
    { heard: 'make it red', atMs: 1790000000004, selection: SEL },
    { event: 'voice-off', voiceSupport: 'browser', message: 'Voice cannot work in this browser: it needs Google Chrome on a computer.' },
  ].map((o) => JSON.stringify(o) + '\n').join(''), vOut.replace(/\n/g, ' | ').slice(0, 260));
t10.t.close();

const noBridge = await cli('listen', '--port', '8799');
ok('no bridge at start: exit 3, and nothing on stdout', noBridge.status === 3 && noBridge.stdout === '');

ok('stdout stayed pure JSON-RPC in every bridge',
  [a, b, c, d, e, f, g].reduce((n, m) => n + m.junk.length, 0) === 0);

for (const m of [a, b, c, d, e, f, g]) { try { m.proc.kill(); } catch {} }
for (const t of [t1, t2, t3, t4, t5, t6, stranger, forger, crossSite, knocker]) { try { t.close?.(); } catch {} }
await wait(200);
fs.rmSync(CFG, { recursive: true, force: true });
console.log(`\n${bad ? `FAILED — ${bad} of ${checks}` : `all ${checks} checks passed`}`);
process.exit(bad ? 1 : 0);
