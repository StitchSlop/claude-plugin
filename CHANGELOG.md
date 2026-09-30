# Changelog

## 0.1.0 — unreleased

The first release.

- **A bridge to the Stitch Slop tab**, wire protocol 1, with no dependencies.
  It opens only when an agent asks. It pairs from the line in the app's Agent
  panel, and reconnects any paired site with no token after that.
- **Sessions share one tab.** A second session drives the first session's
  bridge, and takes it over if that one exits. `ownBridge` gives a second tab
  its own bridge.
- **Refusals are reported to the agent.** The app shows them only as "Waiting
  to connect".
- **The app's commands, as tools**, taken live from the tab and checked: names
  validated, the bridge's own names unshadowable, sizes capped.
- **Files in and out by path**, never as base64 through the model.
  - `call_with_file` takes pictures, SVG, DXF, machine files with their colour
    sidecars, and projects.
  - `call_to_files` saves exports and projects into a folder, never
    overwriting unless asked, and writing only the kinds of file the app
    produces.
  - Replies are kept free of bulk: base64 and very long text become a note.
- **`listen`**: the Talk button's speech wakes the agent between turns. It
  reports the app's voice switch only when it's on, or can't work.
- **Shell commands for sessions without the tools:** `status`, `tools`, `wait`,
  `call` (with `--file`, `--file-text`, `--out`, `--save` and `--raw`), `pair`,
  `listen` and `install-runtime`.
- **Skills:** `design`, for working on a design honestly, and `connect`.
- **No Node.js needed on Claude Code's PATH.** A launcher finds Node where
  version managers and Homebrew put it, or asks the login shell. With none at
  all, it answers the MCP handshake itself and offers `install_runtime`. That
  fetches the official Node.js v24.21.0 from nodejs.org, checks its pinned
  SHA-256, and hands the same connection to the bridge, so the tools appear
  in the session already running. `install-runtime` does the same from a
  shell.
- **Nothing outlives its session.** The bridge exits when its session ends,
  however it ends. `listen` is tied to its session's bridge (`--owner`), so a
  crash no longer leaves it polling for good, where it could take a later
  session's speech. A bridge started from a shell can exit once unused
  (`--exit-when-unused`).
- **`pair` from the shell**, to hand a running bridge the token from the app's
  line.
