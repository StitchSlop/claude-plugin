# Stitch Slop plugin

Lets a user's agent work on the embroidery design open in their
[Stitch Slop](https://www.stitchslop.com) browser tab: see it, describe it, and
change it — every edit one undo step, every answer the app's own sentence.

It is an alternative to the flow where the app asks an agent to *write* a bridge
from the spec at `/agent`. With the plugin installed the bridge is already
there, and the agent has a skill that tells it how to use the surface honestly.

```
.claude-plugin/plugin.json        the manifest
.claude-plugin/marketplace.json   makes this repo its own marketplace
.mcp.json                         starts the bridge as an MCP server, --lazy
bridge/stitchslop-bridge.mjs      the transport. Zero dependencies, Node 18+
skills/design/                    how to connect, and how to work on a design
skills/connect/                   /stitchslop:connect [paste line]
test/                             plugin-path tests and a stand-in tab
```

## Install

```
/plugin marketplace add StitchSlop/StitchSlop_plugin
/plugin install stitchslop@stitchslop
```

The repo is private for now, so this works only for accounts with access to it
(git must be able to clone it — `gh auth login` covers that).

or, from a checkout, `claude --plugin-dir /path/to/StitchSlop_plugin`. Needs
`node` on the PATH. MCP servers start with a session, so the native tools arrive
in the *next* session after installing; the skill covers the one in between
through the bridge's shell face (`skills/design/shell-fallback.md`).

## What the user does

1. In the app: **⌁ Agent** → switch on **Enable Agent Connections**.
2. First time on a machine only: paste the line the panel shows to their agent.
   The agent passes its token to `pair`. After that the machine is paired and
   step 1 is the whole of it.
3. Ask for things.

## What is reused and what is replaced

Per `docs/research/AGENT_SURFACE_HANDOFF.md` in the app repo, the **surface**
(`commands.js`: the registry, the envelope, the Selector) is reused whole — it
runs in the page, and this plugin never sees inside it. The tool list is the
page's, sent live on connect; nothing here snapshots or re-describes a verb, so
the plugin cannot drift from the app. The skill teaches the envelope and the
invariants, and defers to the live tool descriptions for everything else.

The **transport** is replaced. It implements wire protocol 1
(`docs/research/BRIDGE_PROTOCOL.md`) and passes the app's conformance suite,
41 of 41. What a plugin changes about the problem, and so what is different:

| | why |
|---|---|
| `--lazy`: nothing listens until the agent asks | A plugin's MCP server is spawned by *every* session. Binding at start would have each squat a port, and the tab — which dials 8787 first — would attach to whichever session started first, not the one the user is talking to. |
| `pair` tool | The spec hands the one-time token to a bridge at launch; a plugin's server is launched before any token exists. It arrives as a tool argument — not argv (`ps`), not a config file. A lazy bridge therefore does not exit for lack of a credential (spec §1 says a bridge should; without `--lazy` this one does). |
| Following | If a bridge for the same site is already running, this one drives it through its control plane (§4) rather than competing for the tab. If that bridge exits, this one binds and the tab's own poll finds it. `ownBridge: true` opts out, for two tabs. |
| `POST /pair` on the control plane | An extension: how a follower hands its host a token. Same key, same Origin refusal. A host without it (the reference connector) is left alone and the follower opens the next port. |
| Origin allow-list in `pair` | The paste line is untrusted text. Only production and loopback origins are accepted from it; anything else must be set by the user at launch (`STITCHSLOP_ORIGIN`). |
| Busy is decided *before* the token is spent | A tab turned away as busy (§2.6) must still hold a credential it can use on the next port. |
| `pairing.json` keeps the last 5 secrets | Pairing a second browser must not strand the first. `secret` stays the newest, so the reference connector reads the same file unchanged. |
| Heartbeat ping every 30 s | Neither end pinged (§5), so a tab that slept looked attached and the user's next tab was refused as busy. |
| 4 KB frame cap and a 10 s deadline before authentication | Any page can reach the port; nothing unauthenticated gets a buffer. |
| The transport `id` is stripped from results | §3.5. |

`session.json` (the legacy, un-numbered file) is not written; only
`session-<port>.json`.

## Testing

```
npm test                          # the plugin's own paths, on ports 8797-8798
node test/fake-tab.mjs            # a stand-in tab, to develop without the app
```

The protocol is the app repo's to check:

```
node ../WebEmbroidery/scripts/conformance-bridge.mjs -- node bridge/stitchslop-bridge.mjs
```

That suite probes the real 8787–8790 range and skips if anything is listening
there. To run it beside a live bridge, copy it, change its `PORTS` to a spare
range, and append `--port <first>` to the command.

End to end in a real client:

```
node test/fake-tab.mjs --ports 8797 --token tok_fake00000000 &
claude --plugin-dir <a copy whose .mcp.json adds: --origin http://localhost:9999 --port 8797
                     --config-dir <tmp>, and env STITCHSLOP_TOKEN=tok_fake00000000>
```

Claude Code exposes the app's dotted verbs with underscores —
`mcp__plugin_stitchslop_app__scene_describe` — and picks up the late tool list
through `notifications/tools/list_changed`.

## Found on the app side while building this

- `reference-connector.mjs` mints the pairing and spends the token **before**
  the busy check, so a second tab refused as busy has burnt its token and never
  receives the secret.
- Its `toContent` leaves the transport `id` in the JSON shown to the model
  (spec §3.5 says to remove it).
- The connector's messages and `BRIDGE_PROTOCOL.md` call the switch "Allow
  agent connections"; the UI label is "Enable Agent Connections".
- The paste line tells every agent to write a bridge. One clause — "if you have
  the Stitch Slop plugin, pass this token to its `pair` tool instead" — would
  make the line right for both kinds of agent. The skill handles it meanwhile.
