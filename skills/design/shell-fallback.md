# Driving the tab from a shell

For a session that has no `wait_for_connection` tool — the plugin was installed
after the session began, and MCP servers only start with a session. The bridge
has a second face for exactly this: a small authenticated HTTP control plane,
wrapped by the same script as subcommands. Nothing needs restarting. Next
session, the native tools will simply be there; prefer them when they are.

The script's path is given in the design skill's `SKILL.md`, under "The bridge
script". Put it in a variable:

```
BRIDGE="<that path>"
```

## 1. Is a bridge already running?

```
node "$BRIDGE" status
```

Exit `0` with `"connected": true` — skip to step 3. Exit `3` — none is running.

## 2. Start one, in the background

You need the user's paste line for its token, unless this machine is already
paired (then omit the variable). Pass the token in the **environment**, never as
an argument — a command line is readable by every process on the machine.

```
STITCHSLOP_TOKEN=tok_… node "$BRIDGE" --origin https://www.stitchslop.com
```

Run it as a background task. Use the `Origin` from the paste line. It exits by
itself after 30 minutes if no tab ever attaches, and prints its pid and how to
stop it; stop it when the user is finished. Then:

```
node "$BRIDGE" wait 90
```

parks until the tab attaches (exit `0`) or the time runs out (exit `1`).

## 3. Work

```
node "$BRIDGE" tools                                   # the app's tool list — read the descriptions
node "$BRIDGE" call scene.describe
node "$BRIDGE" call params.set '{"target":{"ordinal":2},"values":{"spacing":0.4}}'
node "$BRIDGE" call scene.render '{"width":700}' --out /tmp/design.png
node "$BRIDGE" call background.set '{}' --file image=./logo.png
node "$BRIDGE" listen          # speech from the Talk button, one line each; run it under Monitor
```

- Stdout is the app's envelope as JSON and nothing else. Commentary is on stderr.
- Exit `0` only when `ok` is true; `1` a refusal or a failed command; `3` no
  bridge, or a stale session; `64` a usage error.
- `--out FILE` writes a render's image to FILE and replaces `dataUrl` in the
  printed envelope with `savedTo`. Then read the file to see it. Without
  `--out`, a render is ~140 KB of base64 on stdout.
- `--file KEY=PATH` reads an image (PNG, JPEG, WebP or GIF) and passes it as
  `KEY`, a data URL. Never paste base64 onto a command line: a picture is
  larger than the shell allows.
- With more than one bridge running, every command needs `--port N`; it lists
  them rather than guess, because guessing would drive the wrong document.

Everything in the main skill about reading results applies unchanged — this is
the same envelope, just printed.
