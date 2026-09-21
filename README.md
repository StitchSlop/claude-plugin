# Stitch Slop for Claude Code

Lets Claude work on the embroidery design open in your
[Stitch Slop](https://www.stitchslop.com) browser tab. It can look at it,
describe it, change it, and hear you through the app's Talk button. Every change
is one undo step in the app, and every answer is the app's own words.

## What you need

- **Claude Code**, and **Node.js 18 or newer** on your `PATH`.
- **Stitch Slop open in a desktop browser on the same computer.** Chrome is
  tested; Firefox connects the same way; Safari has not been tested.
- **macOS or Linux.** Windows has not been tested yet.

## Install

In Claude Code:

```
/plugin marketplace add StitchSlop/claude-plugin
/plugin install stitchslop@stitchslop
```

Then **start a new session**: a plugin's tools arrive with a session, not in the
middle of one.

## Connect

**The first time on a computer:**

1. In Stitch Slop, open the **⌁ Agent** panel and switch on **Enable Agent
   Connections**.
2. Click **Copy**, and paste the line into Claude Code.

Chrome will ask once whether the page may "access other apps and services on
this device". That is this connection, to a small bridge on your own computer:
allow it. Firefox doesn't ask.

**After that**, the computer stays paired. With the switch on, just ask Claude
to "connect to Stitch Slop".

## Talk to it

In the ⌁ Agent menu, switch on **Talk to your agent by voice**. Then press
**Talk** (⌥M) and speak. Claude hears you even between turns, and replies in the
app, next to the Talk button. Voice needs Google Chrome on a computer.

## What it can do

About everything the app's commands cover:

- look at the design, as a picture or as facts;
- select, move, resize and align;
- change stitch types and settings, threads and colours;
- lettering and fonts, patches, sewing order and layering;
- trace a background image into stitches;
- check for stitch problems.

The list comes from the app itself, so it grows as the app does.

**Not yet:** exporting a machine file, saving, importing a design, and changing
the fabric. Do those in the app.

## Privacy

The bridge talks only to your own browser tab, over your own computer's
loopback. It sends nothing anywhere and has no telemetry. What Claude reads of
your design — names, lettering, pictures of it, what you say to it — goes to
Anthropic as part of your conversation, as anything you ask Claude about does.

## Turning it off

- **For now:** switch off **Enable Agent Connections**. Nothing connects while
  it is off.
- **For good, on this computer:** delete `~/.stitchslop/pairing.json`. The next
  connection needs the pasted line again.
- **The browser's half:** clear Stitch Slop's site data in the browser's
  settings.
- **The plugin:** `claude plugin uninstall stitchslop@stitchslop`, or through
  `/plugin` in a session.

## When it won't connect

Ask Claude. It can see things the app deliberately does not show, such as why a
connection was refused, and it knows what each of the panel's status words
means. The details are in
[`skills/design/troubleshooting.md`](skills/design/troubleshooting.md).

## Security

See [SECURITY.md](SECURITY.md): what the bridge can do on your computer, what
limits it, and how to report a problem privately.

---

## Development

```
.claude-plugin/plugin.json        the manifest
.claude-plugin/marketplace.json   makes this repo its own marketplace
.mcp.json                         starts the bridge as an MCP server, --lazy
bridge/stitchslop-bridge.mjs      the bridge. Zero dependencies, Node 18+
skills/design/                    how to connect, and how to work on a design
skills/connect/                   /stitchslop:connect [the pasted line]
test/                             the plugin's tests, and a stand-in tab
```

From a checkout: `claude --plugin-dir /path/to/this/repo`.

### How it fits together

The app owns the design and its commands. The plugin never sees inside them.
The tab sends its tool list when it connects, and the bridge carries calls to it
and the app's answers back. Nothing here copies or re-describes a command, so
the plugin cannot drift from the app. The skill teaches how to read the app's
answers and the rules that bite, and defers to the live tool descriptions for
everything else.

The bridge implements Stitch Slop's wire protocol 1, published at
[stitchslop.com/agent](https://www.stitchslop.com/agent). What a plugin changes
about that problem:

| | why |
|---|---|
| `--lazy`: nothing listens until the agent asks | A plugin's MCP server starts with *every* session. Binding at start would have each claim a port, and the tab, which dials 8787 first, would attach to whichever session started first rather than the one you are talking to. |
| The `pair` tool | The protocol hands a bridge its one-time token at launch, but a plugin's server starts before any token exists. So it arrives as a tool argument: not on the command line, where `ps` shows it, and not in a config file. |
| Sharing | If a bridge for the same site is already running, a second session drives it through its control plane instead of competing for the tab. If that bridge exits, the next one takes its port, and the tab reattaches by itself. `ownBridge: true` opts out, for two tabs. |
| Paired sites | A site this computer is paired with reconnects with no token, whichever site the bridge started on. The tab still has to present that site's own secret. |
| Origin allow-list | Pasted text is untrusted. `pair` accepts only the production site and loopback addresses. Anything else must be set by the user, with `STITCHSLOP_ORIGIN`. |
| Refusals are kept | The app shows a refused tab only as "Waiting to connect", so the bridge records why and `connection_status` reports it. |
| The tab's tool list is checked | Names are validated, the bridge's own names can't be shadowed, and sizes are capped. Anything dropped is reported. |
| `call_with_file`, `--file` | An image goes to the app by path, never as base64 typed by the model. Images only, checked by their bytes. |
| `listen` | The Talk button's speech as lines a watching host (Claude Code's Monitor) wakes on. It starts when the agent connects. |
| Heartbeat, frame caps, a pre-auth deadline | A tab that slept must not block the next one, and nothing unauthenticated gets a buffer. |

### Tests

```
npm test                  # the plugin's own tests, on ports 8797-8798 with a temp config dir
node test/fake-tab.mjs    # a stand-in tab: --token or --secret, --utter "…", --voice-on-after N
```

Protocol conformance is checked by the Stitch Slop app's own suite, which is not
public.
