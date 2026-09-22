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
  `call` (with `--file`, `--file-text`, `--out`, `--save` and `--raw`) and
  `listen`.
- **Skills:** `design`, for working on a design honestly, and `connect`.
