# When the tab does not attach

**Start with what the bridge saw, not with the user.** The app's panel shows
every refusal as "Waiting to connect": the user never sees why a tab was turned
away. The bridge does. A wait that times out leads with it, and
`connection_status` has the detail:

- `recentRefusals`: each refusal's `reason`, the tab's `origin`, and how many
  times it happened.
- `connectionAttempts` and `lastAttemptAt`: whether the tab tried at all.

**The discriminator:** if the bridge saw no attempt, the tab is not trying
(switch off, browser block, CSP, or the tab is attached somewhere else). If it
saw attempts and refused them, the site or the credential is wrong. Those need
opposite fixes, and they look identical from the user's chair.

## What the bridge saw

| `reason` | What it is | What to do |
|---|---|---|
| `site` | The tab is on a site this bridge does not admit: not its own, not paired with this machine, and no token given for it | Ask for the line — *"Open the ⌁ Agent panel, switch on Enable Agent Connections, click Copy, and paste the line to me"* — and `pair` with its token and origin. |
| `spent_token` | The tab offered a token that was already used, and no pairing this machine recognises | Tokens are one-time, and a page mints one per load. Ask the user to reload the Stitch Slop page, click Copy, and paste the line; then `pair`. |
| `wrong_pairing` / `unknown_token` | The tab's saved pairing doesn't match `~/.stitchslop/pairing.json`, and its token isn't one this bridge was given | Ask for the line again, and `pair`. |
| `busy` | This bridge is serving another tab; the credential was fine | One tab per bridge. Close the other tab, or, if the user wants two documents driven at once, `wait_for_connection` with `ownBridge: true`. The waiting tab finds the new bridge by itself. |
| *no attempts* | The tab is not dialling this bridge | See the panel's words below. |

## What the panel says

Ask for the status word under **Enable Agent Connections**. There are seven:

| The panel says | What it is | What to do |
|---|---|---|
| **Not connected** | The switch is off. Nothing dials while it is off | Ask them to switch it on. The saved pairing survives off and on. |
| **Waiting to connect** | The tab is dialling and has not attached. **This includes every refusal** | Read what the bridge saw, above. No attempts at all while this shows means the dial never leaves the browser: ask the user to open the browser console, which names a blocked connection (a Content-Security-Policy violation) in one line. That is a site-side bug; nothing on their machine fixes it. Right after a bridge opens, Chrome may take 10–20 s to notice it, because it throttles failed dials. |
| **Connected** | The tab is attached, but not to this session's bridge | `connection_status` → `otherBridges`. Another agent session, or a bridge started by hand, has it. |
| **Disconnected** | It was attached and lost the bridge | Normal when a session ends. `wait_for_connection` reopens one, and the tab reattaches by itself. |
| **Blocked by your browser** | **Chrome only.** The local-network permission was refused, and Chrome remembers it | Allow local network access for the site in the browser's settings (the icon left of the address bar → site settings). Nothing on your side fixes this. Firefox never shows it. |
| **Connected in another tab** | Another Stitch Slop tab holds the connection | Close that tab, or use it. |
| **Agent needs an update** | The app speaks a newer wire protocol than this plugin | `/plugin update stitchslop`, then a new session. |

**Nothing saved?** Before saying so, check `pairedOrigins` in
`connection_status`. It lists every site this machine can reconnect to without
a token. `paired` covers only the site the bridge is serving at that moment.

## Other situations

- **`connection_status` shows `mode: "follower"`.** Another bridge — another
  agent session's, or one started by hand — already serves this site, and this
  session is sharing it through its control plane. That is deliberate: the tab
  only ever attaches to one bridge, so a second session joins rather than
  competes. If that bridge exits, this one takes the port over and the tab
  reattaches by itself within a few seconds.
- **Two agent sessions, one tab.** Both can drive it. Edits interleave in one
  undo history, so say so if the user seems to be doing this by accident.
- **The tab keeps dropping** ("Disconnected" coming and going). Look for a second Stitch Slop tab first. Then
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
