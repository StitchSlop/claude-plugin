/**
 * A stand-in for the Stitch Slop tab, for working on the plugin without the app.
 *
 *   node test/fake-tab.mjs [--origin O] [--token T | --secret S] [--ports 8787,8788]
 *
 * Run directly, it behaves like an armed tab: it walks the ports until a bridge
 * admits it, offers three tools, and answers every command. Imported, it gives
 * the tests a hand-rolled WebSocket client that can send an Origin header —
 * which Node's built-in client cannot.
 */
import crypto from 'node:crypto';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

export const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export function tab(port, origin) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    const key = crypto.randomBytes(16).toString('base64');
    let phase = 'http', buf = Buffer.alloc(0);
    const queue = [], takers = [];
    const deliver = (m) => { const t = takers.shift(); if (t) t(m); else queue.push(m); };
    const api = {
      send(obj) {
        const body = Buffer.from(JSON.stringify(obj)), mask = crypto.randomBytes(4);
        const masked = Buffer.from(body); for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
        let head;
        if (body.length < 126) head = Buffer.from([0x81, 0x80 | body.length]);
        else if (body.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(body.length, 2); }
        else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(body.length), 2); }
        sock.write(Buffer.concat([head, mask, masked]));
      },
      next: (ms = 5000) => new Promise((res) => {
        if (queue.length) { res(queue.shift()); return; }
        const t = (m) => { clearTimeout(timer); res(m); };
        const timer = setTimeout(() => { takers.splice(takers.indexOf(t), 1); res(null); }, ms);
        takers.push(t);
      }),
      /** Behave like the app: offer tools, answer every command. */
      serve(tools, answer) {
        api.send({ tools });
        (async () => { for (;;) { const m = await api.next(60_000); if (!m || m.closed) return; if (m.id != null && m.command) api.send({ ...answer(m), id: m.id }); } })();
      },
      close: () => sock.destroy(),
      closed: false,
    };
    sock.on('error', () => resolve({ rejected: 'unreachable' }));
    sock.on('close', () => { api.closed = true; deliver({ closed: true }); });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (phase === 'http') {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const status = Number(buf.subarray(0, end).toString().split(' ')[1]);
        buf = buf.subarray(end + 4);
        if (status !== 101) { resolve({ rejected: status }); sock.destroy(); return; }
        phase = 'ws'; resolve(api);
      }
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 0x0f; let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const payload = buf.subarray(off, off + len); buf = buf.subarray(off + len);
        if (op === 0x1) { try { deliver(JSON.parse(payload.toString())); } catch {} }
        // Answer pings as a browser does, unasked. Without this the bridge's
        // heartbeat drops the stand-in after 75s, which reads as the tab leaving.
        if (op === 0x9) {
          const mask = crypto.randomBytes(4), body = Buffer.from(payload);
          for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
          sock.write(Buffer.concat([Buffer.from([0x8a, 0x80 | body.length]), mask, body]));
        }
      }
    });
    sock.on('connect', () => sock.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\n`
      + `Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\nOrigin: ${origin}\r\n\r\n`));
  });
}

export const TOOLS = [
  { name: 'scene.describe', description: 'Describe the scene.', inputSchema: { type: 'object' } },
  { name: 'scene.render', description: 'Render the scene.', inputSchema: { type: 'object' } },
  { name: 'object.draw', description: 'Draw an object.', inputSchema: { type: 'object' } },
  { name: 'background.set', description: 'Set the background image.', inputSchema: { type: 'object' } },
];
export const answer = (m) => m.command === 'background.set'
    ? { ok: true, changed: true, say: 'Background image added.', received: String(m.args?.image ?? '').slice(0, 22), receivedLength: String(m.args?.image ?? '').length, opacity: m.args?.opacity }
  : m.command === 'scene.render' ? { ok: true, say: 'Rendered.', dataUrl: `data:image/png;base64,${PNG}`, mmPerPx: 0.2 }
  : m.command === 'object.draw' ? { ok: false, error: 'refused', message: 'A fill needs a closed shape.', say: 'A fill needs a closed shape.', changed: false }
  // `big` makes the reply larger than a pipe's 64KB buffer: the CLI once cut
  // anything past 65,536 bytes when its stdout was a pipe.
  : m.args?.big ? { ok: true, say: 'a big reply', changed: false, filler: 'x'.repeat(200_000) }
  : { ok: true, say: 'two objects, 1,234 stitches', changed: false, items: [{ ordinal: 1, name: 'Leaf', treatment: 'fill', stitches: 1234 }] };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  const origin = arg('--origin', 'http://localhost:9999');
  // --secret plays a browser that is already paired; --token one that is not.
  const credential = arg('--secret') ? { secret: arg('--secret') } : { token: arg('--token', 'tok_fake00000000') };
  const ports = arg('--ports', '8787,8788,8789,8790').split(',').map(Number);
  // --utter "make it red" --utter-after 20: the user presses Talk and says
  // that, N seconds after the tab first attaches. voice.listen waits for it,
  // as the app's does, and hands it over once.
  const utter = arg('--utter');
  const utterAfter = Number(arg('--utter-after', 20)) * 1000;
  let utterAt = null;
  let uttered = false;
  // --voice-on-after N: the app's voice switch, off until N seconds after the
  // first attach, then on. Flipping it ends a waiting voice.listen at once.
  const voiceAfter = arg('--voice-on-after') == null ? null : Number(arg('--voice-on-after')) * 1000;
  let voiceAt = null;
  const voiceIsOn = () => voiceAfter == null || Date.now() >= voiceAt;
  const VOICE_TOOLS = [
    { name: 'voice.listen', description: voiceAfter == null ? 'Hear what the user said.'
      : 'Hear what the user said. `voiceOn` says whether the user has voice switched on.', inputSchema: { type: 'object' } },
    { name: 'voice.say', description: 'Reply to the user on screen.', inputSchema: { type: 'object' } },
  ];
  const listenAnswer = async (m) => {
    const until = Date.now() + Math.min(25, Number(m.args?.timeoutSeconds) || 20) * 1000;
    const wasOn = voiceIsOn();
    const v = () => (voiceAfter == null ? {} : { voiceOn: voiceIsOn() });
    while (Date.now() < until) {
      if (voiceIsOn() !== wasOn) return { ok: true, heard: [], selection: [{ id: 'o_1', name: 'Leaf' }], ...v(),
        say: 'The user just switched voice on. Tell them you are listening, and that they press Talk (⌥M) to speak.' };
      if (utter && !uttered && voiceIsOn() && Date.now() >= utterAt) {
        uttered = true;
        return { ok: true, heard: [{ text: utter, atMs: Date.now() }], selection: [{ id: 'o_1', name: 'Leaf' }], ...v(), say: `The user said: “${utter}”` };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return { ok: true, heard: [], selection: [{ id: 'o_1', name: 'Leaf' }], ...v(), say: voiceIsOn() ? 'Nothing was said.' : 'Voice is off.' };
  };
  for (;;) {
    for (const port of ports) {
      const t = await tab(port, origin);
      if (t.rejected) continue;
      t.send(credential);
      const hello = await t.next();
      if (!hello?.hello) { console.error(`port ${port}: ${hello?.message ?? 'refused'}`); t.close(); continue; }
      if (hello.pairingSecret) { credential.secret = hello.pairingSecret; }
      console.error(`attached on port ${port}`);
      utterAt ??= Date.now() + utterAfter;
      voiceAt ??= Date.now() + (voiceAfter ?? 0);
      t.send({ tools: utter ? [...TOOLS, ...VOICE_TOOLS] : TOOLS });
      (async () => {
        for (;;) {
          const m = await t.next(60_000);
          if (!m || m.closed) return;
          if (m.id == null || !m.command) continue;
          console.error(`<- ${m.command} ${JSON.stringify(m.args).slice(0, 80)}`);
          const r = m.command === 'voice.listen' ? await listenAnswer(m)
            : m.command === 'voice.say' ? { ok: true, shown: m.args?.text, shownAs: 'tip', say: `Shown to the user: “${m.args?.text}”` }
            : answer(m);
          t.send({ ...r, id: m.id });
        }
      })();
      await new Promise((r) => { const iv = setInterval(() => { if (t.closed) { clearInterval(iv); r(); } }, 300); });
      console.error('bridge went away — polling again');
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
