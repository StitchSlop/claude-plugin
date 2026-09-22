# Security

## Reporting a problem

Please report it privately: this repository's **Security** tab → **Report a
vulnerability**. Please don't open a public issue for a security problem.
Fixes go into the latest release; there are no older supported versions.

## What the plugin does on your computer

The plugin runs one program, `bridge/stitchslop-bridge.mjs`, as your user. It
has no dependencies and makes no internet connections. It:

- **Listens on your computer's loopback address only** (`127.0.0.1`, the first
  free port of 8787–8790). It starts listening only when an agent asks to
  connect, not when a session starts.
- **Writes two kinds of file** in `~/.stitchslop/`, both readable only by you
  (mode `0600`):
  - `pairing.json` holds the pairing secret for each Stitch Slop site you have
    connected, plus hashes of spent one-time tokens, never the tokens.
  - `session-<port>.json` holds a key, new on every start, for the bridge's
    local control plane.
- **Carries calls between your agent and your Stitch Slop tab.** The tab owns
  the design and the commands. Every change is one undo step in the app.
- **Reads a file when your agent asks it to** (`call_with_file`, `--file`),
  and sends it to your tab. Only images (PNG, JPEG, WebP or GIF, recognised by
  their contents) and the design files the app reads (SVG, DXF, machine
  formats such as DST and PES, their colour files, and `.stitchslop`
  projects), up to 14 MB. Hidden files and anything else are refused.
- **Writes a file when your agent asks it to** (`call_to_files`, `--save`): an
  export or project the app returns, into the folder your agent names. It writes
  only the kinds of file the app produces, under the file's bare name (never a
  path, never a hidden file), and never overwrites unless told to.
- **Runs `listen`** as a background process while an agent is connected. It
  asks the tab for what you said with the Talk button and prints it for your
  agent. Voice is off in the app until you switch it on.

It never opens a browser, never connects to anything but your own tab, runs
nothing the page sends it, and collects no telemetry.

## The boundaries, and what each one stops

**Any web page can reach a loopback port.** Being on `127.0.0.1` protects
nothing by itself, so a connection has to pass two checks:

1. **The site.** The browser reports which site a connection comes from. The
   bridge admits only the site it serves, one this computer has already paired
   with, or one it has been handed a token for. `pair` accepts only the
   production site and loopback addresses from pasted text; any other site must
   be allowed by you, with `STITCHSLOP_ORIGIN`.
2. **The credential.** The connection must present either a one-time token that
   was handed to this bridge (spent on first use), or the stored pairing secret
   for that same site. Comparisons are constant-time.

**The control plane** (the shell commands `status`, `call`, `listen`, …) needs
the key from a `0600` file, which no web page can read. The bridge also refuses
any control-plane request that carries an `Origin` header, which every browser
request does.

**What the tab sends is treated as data.** Tool descriptions and results come
from your own tab. They go into the agent's context, and in Claude Code that
agent can run commands. So the bridge validates tool names, stops a page from
shadowing the bridge's own tools, and caps sizes. The skill tells the agent
that text from the design, including object names and lettering, is never an
instruction.

## What it does not protect against

- **A compromised Stitch Slop site.** If an attacker could run script on
  stitchslop.com (for example, through an XSS flaw in the app), that script
  would *be* your tab, with your pairing. It could offer misleading tool
  descriptions and results to your agent, which is a prompt-injection route into
  an agent that has a shell. The checks above bound the size and shape of what
  it can send, and your agent's own permission prompts still apply. They do not
  make this safe. It is the most serious risk here, and it is the app's to
  prevent.
- **Other programs running as you.** Anything already running under your
  account can read the `0600` files. That is outside what a file mode can stop,
  as it is for SSH keys.
- **Windows.** The control plane's key relies on Unix file modes, which Windows
  does not enforce the same way. Windows is untested and not yet supported.
- **Files you point it at.** `call_with_file` sends the image or design file
  your agent names. It won't send other kinds of file, but it will send any
  image or design file your agent chooses. `call_to_files` writes into any folder
  your agent chooses. So your agent's permission prompts for both matter.

## Revoking access

- Switch off **Enable Agent Connections** in the app: nothing connects.
- Delete `~/.stitchslop/pairing.json`: every stored pairing is gone, and the
  next connection needs the pasted line again.
- Clear Stitch Slop's site data in your browser, to forget the browser's half.
