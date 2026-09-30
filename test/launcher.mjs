// SPDX-License-Identifier: Apache-2.0
/**
 * bin/stitchslop-bridge, the launcher: finding a Node that Claude Code's own
 * PATH lacks, and what happens when there is none at all.
 *
 * Field report, 2026-09-30: with Node only through nvm, the plugin's
 * `node …` spawn failed in 3 ms with ENOENT, Claude Code cached the failure,
 * and the session had none of the plugin's tools, with nothing saying why.
 *
 * Every case runs with a PATH that has no node and a HOME of its own. The
 * "download" is a local tarball served over file://, so nothing touches the
 * network or the real ~/.stitchslop.
 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER = path.join(ROOT, 'bin', 'stitchslop-bridge');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stitchslop-launcher-')));
const NODE = process.execPath;
const VERSION = 'v24.21.0';
const uname = (f) => spawnSync('uname', [f], { encoding: 'utf8' }).stdout.trim();
const PLAT = `${{ Darwin: 'darwin', Linux: 'linux' }[uname('-s')]}-${{ arm64: 'arm64', aarch64: 'arm64', x86_64: 'x64' }[uname('-m')]}`;

let bad = 0, checks = 0;
const ok = (label, cond, detail = '') => { checks++; if (!cond) bad++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** An environment where nothing finds node unless the case puts it there. */
const bare = (extra = {}) => ({
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: path.join(TMP, 'home'), SHELL: '/usr/bin/false',
  STITCHSLOP_NODE_CANDIDATES: '', STITCHSLOP_RUNTIME_DIR: path.join(TMP, 'runtime'), ...extra,
});
fs.mkdirSync(path.join(TMP, 'home'), { recursive: true });
const run = (args, env) => spawnSync('sh', [LAUNCHER, ...args], { env, encoding: 'utf8', timeout: 30_000 });

/** A stand-in for node that says it was used, then is node. */
function wrapper(file, tag) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/bin/sh\n[ "$1" = "-e" ] || [ "$1" = "-p" ] || echo ${tag} >&2\nexec "${NODE}" "$@"\n`, { mode: 0o755 });
}

console.log('finding node');
ok('with node on the PATH, it runs the bridge', /stitchslop-bridge .* protocol 1/.test(run(['--version'], process.env).stdout));

// Only through nvm: the shape of the field report. An old version sits beside it.
const nvmHome = path.join(TMP, 'nvm-home');
wrapper(path.join(nvmHome, '.nvm/versions/node/v22.3.0/bin/node'), 'USED-NVM-NODE');
fs.mkdirSync(path.join(nvmHome, '.nvm/versions/node/v16.0.0/bin'), { recursive: true });
fs.writeFileSync(path.join(nvmHome, '.nvm/versions/node/v16.0.0/bin/node'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
const env = { ...bare({ HOME: nvmHome }) };
delete env.STITCHSLOP_NODE_CANDIDATES;             // the real search, not the test list
const viaNvm = run(['--version'], env);
ok('with Node only through nvm, it finds it and not the old one beside it',
  /protocol 1/.test(viaNvm.stdout) && /USED-NVM-NODE/.test(viaNvm.stderr), (viaNvm.stderr + viaNvm.stdout).slice(0, 120));

const cached = path.join(TMP, 'cached-runtime');
wrapper(path.join(cached, `node-${VERSION}-${PLAT}/bin/node`), 'USED-CACHED-RUNTIME');
const viaCache = run(['--version'], bare({ STITCHSLOP_RUNTIME_DIR: cached }));
ok('with no Node anywhere but a fetched runtime, it uses that', /USED-CACHED-RUNTIME/.test(viaCache.stderr) && /protocol 1/.test(viaCache.stdout));

// Last resort: the user's own shell, rc files and all.
const shellNode = path.join(TMP, 'shell-node', 'node');
wrapper(shellNode, 'USED-LOGIN-SHELL-NODE');
const fakeShell = path.join(TMP, 'fake-zsh');
fs.writeFileSync(fakeShell, `#!/bin/sh\necho "welcome, rc noise"\necho "${shellNode}"\n`, { mode: 0o755 });
const viaShell = run(['--version'], bare({ SHELL: fakeShell }));
ok('with Node only in the login shell, it asks that shell', /USED-LOGIN-SHELL-NODE/.test(viaShell.stderr) && /protocol 1/.test(viaShell.stdout));
const hangShell = path.join(TMP, 'hang-zsh');
fs.writeFileSync(hangShell, '#!/bin/sh\nsleep 60\n', { mode: 0o755 });
const t0 = Date.now();
const hung = run(['status'], bare({ SHELL: hangShell }));
ok('  ...and a shell that hangs is given up on within seconds', hung.status === 69 && Date.now() - t0 < 9000, `${Date.now() - t0} ms`);

const none = run(['status'], bare());
ok('with no Node at all, a shell command says so and how to fix it, exit 69',
  none.status === 69 && /install-runtime/.test(none.stderr) && /nodejs\.org/.test(none.stderr) && none.stdout === '', none.stderr.slice(0, 100));

/* ------------------------------------------ a download, served locally -- */
const dist = path.join(TMP, 'dist');
const pkg = path.join(TMP, 'pkg', `node-${VERSION}-${PLAT}`);
fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
fs.symlinkSync(NODE, path.join(pkg, 'bin', 'node'));
fs.mkdirSync(dist, { recursive: true });
const ext = PLAT.startsWith('linux') && spawnSync('sh', ['-c', 'command -v xz']).status !== 0 ? 'tar.gz' : 'tar.xz';
const tarball = path.join(dist, `node-${VERSION}-${PLAT}.${ext}`);
spawnSync('tar', [ext === 'tar.xz' ? '-cJf' : '-czf', tarball, '-C', path.join(TMP, 'pkg'), `node-${VERSION}-${PLAT}`]);
const SHA = crypto.createHash('sha256').update(fs.readFileSync(tarball)).digest('hex');
const served = (extra = {}) => bare({ STITCHSLOP_RUNTIME_BASE: `file://${dist}`, STITCHSLOP_RUNTIME_SHA256: SHA, ...extra });

console.log('\ninstall-runtime, from a shell');
const rt1 = path.join(TMP, 'rt-cli');
const inst = run(['install-runtime'], served({ STITCHSLOP_RUNTIME_DIR: rt1 }));
ok('it fetches, checks and unpacks the runtime', inst.status === 0 && fs.existsSync(path.join(rt1, `node-${VERSION}-${PLAT}/bin/node`)), inst.stderr.slice(0, 120));
ok('  ...leaving nothing half-done beside it', fs.readdirSync(rt1).join() === `node-${VERSION}-${PLAT}`, fs.readdirSync(rt1).join());
ok('  ...after which a shell command runs', run(['--version'], served({ STITCHSLOP_RUNTIME_DIR: rt1 })).status === 0);
const rtBad = path.join(TMP, 'rt-bad');
const badSum = run(['install-runtime'], served({ STITCHSLOP_RUNTIME_DIR: rtBad, STITCHSLOP_RUNTIME_SHA256: '0'.repeat(64) }));
ok('a download whose SHA-256 does not match is discarded, and nothing is installed', badSum.status === 1
  && /did not match/.test(badSum.stderr) && (!fs.existsSync(rtBad) || fs.readdirSync(rtBad).length === 0), badSum.stderr.slice(0, 120));

/* --------------------------------------------- MCP, with no Node at all -- */
function mcp(env) {
  const cfg = fs.mkdtempSync(path.join(TMP, 'cfg-'));
  const proc = spawn('sh', [LAUNCHER, '--lazy', '--origin', 'http://localhost:9999', '--config-dir', cfg, '--port', '8811'],
    { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const inbox = [], notes = [], junk = [];
  let out = '', err = '';
  proc.stderr.on('data', (c) => { err += c; });
  proc.stdout.on('data', (c) => {
    out += c;
    for (let nl; (nl = out.indexOf('\n')) >= 0;) {
      const line = out.slice(0, nl).trim(); out = out.slice(nl + 1);
      if (!line) continue;
      try { const m = JSON.parse(line); (m.id === undefined ? notes : inbox).push(m); } catch { junk.push(line); }
    }
  });
  const send = (obj) => proc.stdin.write(JSON.stringify(obj) + '\n');
  const request = async (id, method, params, ms = 30_000) => {
    send({ jsonrpc: '2.0', id, method, params });
    for (const until = Date.now() + ms; Date.now() < until; await wait(30)) {
      const hit = inbox.find((m) => m.id === id);
      if (hit) return hit;
    }
    return null;
  };
  return { proc, inbox, notes, junk, send, request, err: () => err };
}
const textOf = (r) => (r?.result?.content ?? []).map((b) => b.text ?? '').join('\n');

console.log('\nMCP, with no Node at all');
const rt2 = path.join(TMP, 'rt-mcp');
const m = mcp(served({ STITCHSLOP_RUNTIME_DIR: rt2 }));
// Claude Code's shape: id before params, and "id" keys nested deeper that must not be mistaken for it.
const init = await m.request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: { elicitation: {} },
  clientInfo: { name: 'claude-code', version: '9' }, _meta: { id: 'not-this-one' } });
ok('it answers the handshake instead of dying', init?.result?.serverInfo?.name === 'stitchslop-connector'
  && init.result.protocolVersion === '2025-06-18' && init.result.capabilities?.tools?.listChanged === true);
ok('  ...with instructions saying what is missing and what install_runtime does',
  /cannot find one/.test(init?.result?.instructions ?? '') && /install_runtime/.test(init?.result?.instructions ?? '')
  && /SHA-256/.test(init?.result?.instructions ?? ''), (init?.result?.instructions ?? '').slice(0, 90));
m.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
const list0 = await m.request('two', 'tools/list', {});
ok('it lists install_runtime, and a wait_for_connection that explains (a string id works)',
  (list0?.result?.tools ?? []).map((t) => t.name).join() === 'install_runtime,wait_for_connection');
const early = await m.request(3, 'tools/call', { name: 'wait_for_connection', arguments: { timeoutSeconds: 5 } });
ok('  ...and calling wait_for_connection says to install first', early?.result?.isError === true && /install_runtime/.test(textOf(early)));
ok('ping is answered', (await m.request(4, 'ping', {}))?.result !== undefined);
ok('an unknown method is -32601', (await m.request(5, 'nonsense/method', {}))?.error?.code === -32601);

const installed = await m.request(6, 'tools/call', { name: 'install_runtime', arguments: {} }, 60_000);
ok('install_runtime installs, and says the tools are coming', installed?.result && !installed.result.isError
  && /Installed Node\.js/.test(textOf(installed)), textOf(installed).slice(0, 100));
for (let i = 0; i < 100 && !m.notes.some((n) => n.method === 'notifications/tools/list_changed'); i++) await wait(50);
ok('  ...then the bridge takes the same connection over and announces its tools',
  m.notes.some((n) => n.method === 'notifications/tools/list_changed'));
const list1 = await m.request(7, 'tools/list', {});
const names1 = (list1?.result?.tools ?? []).map((t) => t.name);
ok('  ...which are the bridge\'s own, in this same session', ['wait_for_connection', 'pair', 'connection_status', 'call_to_files']
  .every((n) => names1.includes(n)) && !names1.includes('install_runtime'), names1.join(','));
const status = await m.request(8, 'tools/call', { name: 'connection_status', arguments: {} });
ok('  ...and answer', /"mode": "idle"/.test(textOf(status)), textOf(status).slice(0, 60));
ok('nothing but JSON-RPC on stdout, throughout', m.junk.length === 0, m.junk[0] ?? '');
m.proc.kill();

const m2 = mcp(served({ STITCHSLOP_RUNTIME_DIR: path.join(TMP, 'rt-mcp-bad'), STITCHSLOP_RUNTIME_SHA256: 'f'.repeat(64) }));
await m2.request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
const failed = await m2.request(2, 'tools/call', { name: 'install_runtime', arguments: {} }, 60_000);
ok('a failed install is an error result that says why, and the server keeps answering',
  failed?.result?.isError === true && /did not match/.test(textOf(failed)) && (await m2.request(3, 'ping', {}))?.result !== undefined,
  textOf(failed).slice(0, 100));
m2.proc.kill();

await wait(200);
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${bad ? `FAILED — ${bad} of ${checks}` : `all ${checks} checks passed`}`);
process.exit(bad ? 1 : 0);
