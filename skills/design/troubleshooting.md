# When the tab does not attach

Start with `connection_status`. Then match what the **user's ⌁ Agent panel
says** — it reports its own state in words, and those words are the best
evidence there is. Ask the user to read it to you.

| The panel says | What it is | What to do |
|---|---|---|
| *Waiting for your agent to start the connector…* | Nothing answered on 8787–8790 yet | Normal for the first seconds after `wait_for_connection`. Chrome throttles repeated failed dials, so the tab may take 10–20 s to notice a bridge that has just opened. Wait again. |
| *Still waiting. If your agent says it is running, check this: … --origin …* | Either nothing is listening, or a bridge is listening for a **different site** — the browser cannot tell a 403 from a dead port | Compare the origin in that message with `origin` from `connection_status`. If they differ, ask for the paste line and `pair` with its Origin. |
| A credential refusal (*token has already been used*, *does not match this machine's pairing*) | The tab's token is not one this bridge was given, and its stored pairing is not in `~/.stitchslop/pairing.json` | Ask the user to copy the current line from the panel and paste it to you; pass its token to `pair`. If it keeps refusing, the panel's **Forget pairing** button clears the browser's half; then a fresh line and `pair`. |
| *…already serving another Stitch Slop tab* (busy) | A bridge is serving a different tab. The credential was fine | One tab per bridge. Close the other tab, or — if the user wants two documents driven at once — `wait_for_connection` with `ownBridge: true`; the waiting tab finds the new bridge on its own. |
| *Another tab took this connection* (displaced) | Terminal for that tab: it stops polling on purpose, so two tabs cannot fight | The user switches Enable Agent Connections off and on in the tab they want. |
| *Your browser is blocking this page…* (denied) | **Chrome only.** The local-network permission was refused, and Chrome remembers | The user allows it in the site's settings (the icon left of the address bar → site settings), then switches the toggle back on. Nothing on your side fixes this. |
| *That connector speaks protocol N* | The app has moved to a newer wire protocol than this plugin | The plugin needs updating: `/plugin update stitchslop`. |
| Nothing at all, and the state line never changes | The switch is off, or the dial is blocked before any socket opens (a Content-Security-Policy violation) | Ask whether the switch is on. If it is, ask the user to open the browser console — it names a blocked connection in one line. That is a site-side bug; nothing on their machine fixes it. |

**The discriminator:** if the bridge never saw a connection, the browser never
tried (switch off, permission, CSP). If it saw one and turned it away, the
origin or the credential is wrong. Those need opposite fixes and look identical
from the user's chair.

## Other situations

- **`connection_status` shows `mode: "follower"`.** Another bridge — another
  agent session's, or one started by hand — already serves this site, and this
  session is sharing it through its control plane. That is deliberate: the tab
  only ever attaches to one bridge, so a second session joins rather than
  competes. If that bridge exits, this one takes the port over and the tab
  reattaches by itself within a few seconds.
- **Two agent sessions, one tab.** Both can drive it. Edits interleave in one
  undo history, so say so if the user seems to be doing this by accident.
- **The tab keeps dropping.** Look for a second Stitch Slop tab first. Then
  laptop sleep: the bridge drops a tab that stops answering pings for ~75 s, and
  the tab reconnects on its own when it wakes.
- **Every port is busy.** Four bridges is the limit (8787–8790).
  `connection_status` lists them under `otherBridges` with their pids; ask the
  user before stopping anything.
- **A non-production site** (a self-hosted or preview deployment): `pair`
  refuses origins other than production and loopback, because the paste line is
  untrusted text. The user can allow theirs by setting `STITCHSLOP_ORIGIN` in
  the environment Claude Code starts from. That is their decision to make, not
  one to make for them.

Pairings live in `~/.stitchslop/pairing.json` (mode 0600), keyed by site. They
are shared with any other Stitch Slop bridge on this machine, so a user who
already paired one keeps working without a token.
