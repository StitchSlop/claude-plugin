// SPDX-License-Identifier: Apache-2.0
/**
 * What stops the bridge and `listen`, and that nothing outlives its session.
 *
 * Measured against Claude Code, 2026-09-30:
 *   - a normal exit, SIGTERM or SIGHUP: it stops its Monitor and background
 *     commands, and the bridge exits because its stdin closes;
 *   - SIGKILL (a crash or a force quit): the bridge still exits, because its
 *     stdin still closes, but a Monitor command such as `listen` was left
 *     running, orphaned, for good.
 *
 * These tests reproduce what each process sees: the bridge's stdin closing,
 * an owner pid vanishing, a bridge killed outright. Port 8817, temp config.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tab, TOOLS, answer } from './fake-tab.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER = path.join(ROOT, 'bin', 'stitchslop-bridge');
const BRIDGE = path.join(ROOT, 'bridge', 'stitchslop-bridge.mjs');
const ORIGIN = 'http://localhost:9999';
const PORT = 8817;
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stitchslop-life-')));

let bad = 0, checks = 0;
const ok = (label, cond, detail = '') => { checks++; if (!cond) bad++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const portOpen = (port) => new Promise((res) => {
  const s = net.connect({ port, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); res(true); });
  s.once('error', () => res(false));
});
const until = async (cond, ms) => { for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await cond()) return true; return cond(); };

const LISTEN_TOOL = { name: 'voice.listen', description: 'x', inputSchema: { type: 'object' } };
async function attachTab(token) {
  const t = await tab(PORT, ORIGIN);
  t.send(token.startsWith('tok_') ? { token } : { secret: token });
  const hello = await t.next();
  t.serve([...TOOLS, LISTEN_TOOL], (m) => m.command === 'voice.listen' ? { ok: true, heard: [], selection: [] } : answer(m));
  return { t, hello };
}

/** A bridge as a plugin session runs it: the launcher, MCP on stdio. */
function mcpBridge(cfg) {
  const proc = spawn('sh', [LAUNCHER, '--lazy', '--origin', ORIGIN, '--port', String(PORT), '--config-dir', cfg],
    { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, STITCHSLOP_TOKEN: 'tok_0123456789ab' } });
  const inbox = [];
  let buf = '';
  proc.stdout.on('data', (c) => {
    buf += c;
    for (let nl; (nl = buf.indexOf('\n')) >= 0;) { try { inbox.push(JSON.parse(buf.slice(0, nl))); } catch {} buf = buf.slice(nl + 1); }
  });
  const request = async (id, method, params, ms = 30_000) => {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    for (const end = Date.now() + ms; Date.now() < end; await wait(30)) { const hit = inbox.find((m) => m.id === id); if (hit) return hit; }
    return null;
  };
  return { proc, request };
}
function listenProc(args) {
  const p = spawn(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  p.stdout.on('data', (c) => { out += c; });
  const exited = new Promise((r) => p.on('close', (code) => r(code)));
  return { p, out: () => out, exited };
}
const parseHanded = (t) => [...(/^\s*(".+ listen .*)$/m.exec(t)?.[1] ?? '').matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);

/* ===================== the session ends: the bridge's stdin closes ========= */
console.log('a plugin session ends');
const cfg1 = path.join(TMP, 'cfg1');
const b = mcpBridge(cfg1);
await b.request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
b.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const waiting = b.request(2, 'tools/call', { name: 'wait_for_connection', arguments: { timeoutSeconds: 20 } });
await until(() => portOpen(PORT), 5000);
const { t: t1 } = await attachTab('tok_0123456789ab');
const greeting = (await waiting)?.result?.content?.[0]?.text ?? '';
const handed = parseHanded(greeting);
ok('the connect result\'s listen command names its session\'s bridge as owner',
  handed.includes('--owner') && Number(handed[handed.indexOf('--owner') + 1]) === b.proc.pid, handed.slice(2).join(' '));
const l1 = listenProc(handed);
await wait(1500);
ok('  ...and that listener runs', alive(l1.p.pid));
ok('the bridge holds the port and a session file', await portOpen(PORT) && fs.existsSync(path.join(cfg1, `session-${PORT}.json`)));

b.proc.stdin.end();                                  // what any end of the session does to it, SIGKILL included
ok('when its session ends, the bridge exits', await until(() => !alive(b.proc.pid), 5000));
ok('  ...the port is freed', await until(async () => !(await portOpen(PORT)), 5000));
ok('  ...its session file is removed', !fs.existsSync(path.join(cfg1, `session-${PORT}.json`)));
ok('  ...and its listener exits too, saying why', await until(() => l1.p.exitCode !== null, 6000)
  && /"event":"unavailable".*session .* has ended/.test(l1.out()), l1.out().trim().slice(-120));
t1.close();

/* ====== a following session ends while the bridge it shared lives on ===== */
console.log('\na session sharing another\'s bridge ends');
const cfg2 = path.join(TMP, 'cfg2');
const host = spawn('node', [BRIDGE, '--origin', ORIGIN, '--port', String(PORT), '--config-dir', cfg2],
  { stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, STITCHSLOP_TOKEN: 'tok_1111111111aa' } });
await until(() => portOpen(PORT), 5000);
const { t: t2 } = await attachTab('tok_1111111111aa');
await wait(500);
// The follower session's own process, standing in: when it goes, so must its listener.
const followerSession = spawn('sleep', ['60']);
const l2 = listenProc([process.execPath, BRIDGE, 'listen', '--port', String(PORT), '--config-dir', cfg2, '--owner', String(followerSession.pid)]);
await wait(1500);
followerSession.kill('SIGKILL');
ok('its listener exits, though the bridge it listened through is still up',
  await until(() => l2.p.exitCode !== null, 6000) && alive(host.pid) && /session .* has ended/.test(l2.out()), l2.out().trim().slice(-100));

/* ================= a bridge killed outright, with no --owner given ======== */
console.log('\na bridge killed outright');
const l3 = listenProc([process.execPath, BRIDGE, 'listen', '--port', String(PORT), '--config-dir', cfg2]);
await wait(1500);
ok('a listener started by hand runs', alive(l3.p.pid));
host.kill('SIGKILL');
ok('when its bridge is killed, it exits instead of retrying for ever',
  await until(() => l3.p.exitCode !== null, 8000) && /"event":"unavailable"/.test(l3.out()), l3.out().trim().slice(-100));
t2.close();
await until(async () => !(await portOpen(PORT)), 3000);

/* ================== a bridge an agent started from its shell ============= */
console.log('\na bridge started from a shell, with --exit-when-unused');
const cfg3 = path.join(TMP, 'cfg3');
const shellBridge = spawn('sh', [LAUNCHER, '--origin', ORIGIN, '--port', String(PORT), '--config-dir', cfg3, '--exit-when-unused', '0.05'],
  { stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, STITCHSLOP_TOKEN: 'tok_2222222222bb' } });
await until(() => portOpen(PORT), 5000);
const { t: t3 } = await attachTab('tok_2222222222bb');
const l4 = listenProc([process.execPath, BRIDGE, 'listen', '--port', String(PORT), '--config-dir', cfg3]);
const started = Date.now();
ok('with a tab attached and a listener polling, it still exits once unused (3 s here)',
  await until(() => !alive(shellBridge.pid), 10_000), `${Date.now() - started} ms`);
ok('  ...freeing the port', await until(async () => !(await portOpen(PORT)), 3000));
ok('  ...and the listener follows it', await until(() => l4.p.exitCode !== null, 8000));
t3.close();

const cfg4 = path.join(TMP, 'cfg4');
const used = spawn('sh', [LAUNCHER, '--origin', ORIGIN, '--port', String(PORT), '--config-dir', cfg4, '--exit-when-unused', '0.05'],
  { stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, STITCHSLOP_TOKEN: 'tok_3333333333cc' } });
await until(() => portOpen(PORT), 5000);
for (let i = 0; i < 7; i++) {                          // an agent at work: a command every second
  spawn(process.execPath, [BRIDGE, 'status', '--port', String(PORT), '--config-dir', cfg4], { stdio: 'ignore' });
  await wait(1000);
}
ok('a bridge that is in use stays up past the limit', alive(used.pid));
used.kill('SIGTERM');
await until(async () => !(await portOpen(PORT)), 3000);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${bad ? `FAILED — ${bad} of ${checks}` : `all ${checks} checks passed`}`);
process.exit(bad ? 1 : 0);
