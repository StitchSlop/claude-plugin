# Driving the tab from a shell

For a session that has no `wait_for_connection` tool — the plugin was installed
after the session began, and MCP servers only start with a session. The bridge
has a second face for exactly this: a small authenticated HTTP control plane,
wrapped by the same script as subcommands. Nothing needs restarting. Next
session, the native tools will simply be there; prefer them when they are.

The launcher's path is given in the design skill's `SKILL.md`, under "The
bridge's launcher". Put it in a variable, and run it with `sh`: it finds a
Node.js for the bridge even when your shell has no `node`.

```
BRIDGE="<that path>"
```

## 1. Is a bridge already running?

```
sh "$BRIDGE" status
```

- Exit `0` with `"connected": true`: skip to step 3.
- Exit `3`: none is running.
- Exit `69`: there is no Node.js on this computer for the bridge. Tell the
  user, then `sh "$BRIDGE" install-runtime`. It fetches the official Node.js
  from nodejs.org (about 30 MB), checks its pinned SHA-256, and keeps it in
  `~/.stitchslop/runtime` for this plugin only.

## 2. Start one, in the background

You need the user's paste line for its token, unless this machine is already
paired (then omit the variable). Pass the token in the **environment**, never as
an argument — a command line is readable by every process on the machine.

```
STITCHSLOP_TOKEN=tok_… sh "$BRIDGE" --origin https://www.stitchslop.com --exit-when-unused 120
```

`--exit-when-unused 120` makes it exit after two hours in which no command of
yours has used it. Claude Code stops it when this session ends, but not after a
crash, and without the flag it would then hold one of the four ports for good.
If it has exited when you next need it, start it again: no token is needed once
paired.

**A bridge is already running, and the user has just pasted a line?** Hand it
the token; there is no need to restart it:

```
sh "$BRIDGE" pair tok_… --origin <the line's Origin>
```

Run it as a background task. Use the `Origin` from the paste line. It exits by
itself after 30 minutes if no tab ever attaches, and prints its pid and how to
stop it; stop it when the user is finished. Then:

```
sh "$BRIDGE" wait 90
```

parks until the tab attaches (exit `0`) or the time runs out (exit `1`).

## 3. Work

```
sh "$BRIDGE" tools                                   # the app's tool list — read the descriptions
sh "$BRIDGE" call scene.describe
sh "$BRIDGE" call params.set '{"target":{"ordinal":2},"values":{"spacing":0.4}}'
sh "$BRIDGE" call scene.render '{"width":700}' --out /tmp/design.png
sh "$BRIDGE" call background.set '{}' --file image=./logo.png
sh "$BRIDGE" call design.import '{"name":"logo.dst"}' --file data=./logo.dst
sh "$BRIDGE" call project.open '{}' --file-text text=./leaf.stitchslop
sh "$BRIDGE" call design.export '{"format":"dst","deliver":"data"}' --save ./out
sh "$BRIDGE" call project.download '{"deliver":"data"}' --save ./out --text-file leaf.stitchslop
sh "$BRIDGE" listen          # speech from the Talk button, one line each; run it under Monitor
```

- Stdout is the app's envelope as JSON and nothing else. Commentary is on stderr.
- Exit `0` only when `ok` is true; `1` a refusal or a failed command; `3` no
  bridge, or a stale session; `64` a usage error; `69` no Node.js (see step 1).
- `--out FILE` writes a render's image to FILE and replaces `dataUrl` in the
  printed envelope with `savedTo`. Then read the file to see it. Without
  `--out`, a render is ~140 KB of base64 on stdout.
- `--file KEY=PATH` reads a file and passes it as `KEY`, a data URL.
  `--file-text KEY=PATH` passes it as text instead (for `.svg`, `.dxf` and
  `.stitchslop`). `KEY` may be dotted, as in `sidecar.data`. The file must be
  an image or a design file the app reads. Never paste base64 onto a command
  line: a file is larger than the shell allows.
- `--save DIR` writes every file a reply returns into `DIR`, under the app's
  names (an export's machine file and its colour files), and prints `savedTo`
  in their place. `--text-file NAME` also saves the reply's `text`, which is
  what `project.download` returns. It won't overwrite without `--overwrite`.
- Without `--save`, bulk (base64, or text over 100,000 characters) is printed as
  a short note, not dumped into your context. `--raw` prints it all.
- With more than one bridge running, every command needs `--port N`; it lists
  them rather than guess, because guessing would drive the wrong document.

Everything in the main skill about reading results applies unchanged — this is
the same envelope, just printed.
