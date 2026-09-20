# Roadmap

*Written 2026-09-19. Where a claim has not been verified it says so.*

## Where this stands

Built and checked:

- The bridge implements wire protocol 1 and passes the app's conformance suite,
  41 of 41 (run on ports 8797–8800; the real range was occupied).
- The plugin's own paths — lazy binding, `pair`, following, takeover, two tabs,
  the shell CLI — pass 37 of 37 (`npm test`).
- One end-to-end run in a headless Claude Code session against the stand-in tab:
  connected, picked up the late tool list, saw a render as an image, relayed a
  refusal in the app's words.

First real-app run, 2026-09-19, against a local dev server
(`http://localhost:8090`):

- A fresh session given only the paste line called `pair` and did not write a
  bridge or fetch `/agent`.
- The plugin's bridge landed on 8789 beside two other bridges on 8787 and 8788,
  and the tab walked past them and found it.
- The token was spent and a pairing minted alongside the older one.
- **Found:** the greeting did not say how the tab authenticated, so the agent
  told the user the token "may not have been used" when it had just paired the
  machine. Fixed; the greeting now states it.
- **Found while tracing that:** parallel `wait_for_connection` and `pair` calls
  could both bind and open a second port. Fixed; `ensureTransport` is
  serialised, and a test sends both calls in one write to reproduce it.

Still untested: the production origin, and every browser but the one used.

## Open decisions

These change what gets built, so they come before the phases.

**1. Who is this for?** Claude Code users are developers; most embroiderers are
not, and would more likely use Claude Desktop.

| client | reach | what it takes |
|---|---|---|
| Claude Code | works today | this plugin |
| Claude Desktop | bridge works as-is (plain stdio MCP) | a `.mcpb` bundle. Skills do not ship in that format, so the guidance has to move into the server's `instructions` and MCP prompts |
| Codex, Cursor, Gemini CLI | bridge works as-is | config snippets; same prompt-based guidance as Desktop |
| claude.ai, mobile | cannot reach loopback at all | the relay (`mcp.stitchslop.com`) that `MCP_TRANSPORT_RESEARCH.md` §5.3 describes and nobody has built |

Exposing the skill text as an MCP prompt covers rows two and three at once, and
is worth doing regardless of the answer.

**2. Where does the plugin live?** Pushing to a marketplace repo ships code onto
users' machines. A repo many agents commit to is the wrong home for that; this
one should have a protected `main` and tagged releases (Phase 4).

**3. Is the unofficial marketplace enough,** or should this be submitted to a
public directory? Requirements not yet investigated.

---

## Phase 0 — prove it on the real app

- [x] Real tab, local dev origin: first-time `pair` from the paste line in a
      fresh session (2026-09-19).
- [ ] The same on the production origin, then a returning visit with no token.
- [ ] Chrome specifically: the permission prompt on first connection, and what
      the plugin says after a Block.
- [ ] Firefox (no permission prompt expected).
- [ ] Safari. **Unverified:** it may block insecure `ws://127.0.0.1` from an
      HTTPS page outright. If so, document it as unsupported.
- [ ] Two sessions sharing one tab; one session ending while the other works.
- [ ] Two tabs with `ownBridge`.
- [x] Alongside bridges that write no `session-*.json` (the Python bridges on
      8787–8788). The plugin cannot follow those; it took 8789 and the tab
      found it (2026-09-19).
- [ ] A large design: how big is `scene.describe`, and does a 3D render fit
      inside the 60 s call timeout?

Done when: a user who has never seen the plugin gets from install to "make the
text navy" with nothing but the README.

## Phase 1 — hardening, before anyone else installs it

- [ ] **Tool-name shadowing.** Page-supplied tool names are not filtered, so a
      page can list a tool called `pair`. Validate names against a pattern, drop
      collisions with the bridge's own tools, cap description length and tool
      count. Test it.
- [ ] **`SECURITY.md` with the threat model.** The page's tool descriptions
      enter the model's context, and in Claude Code the agent has a shell. So an
      XSS on the app's origin is a prompt injection into a shell-capable agent.
      State what bounds that (origin check, credential, `pair`'s origin
      allow-list, one undo step per call) and what does not. Include how to
      report a problem.
- [ ] **Windows.** Untested. The control plane's authentication *is* the 0600
      file mode, which means nothing there; decide between ACLs, a named pipe,
      or documenting the weaker guarantee. Also signals and path handling.
- [ ] **`node` on the PATH is assumed.** The native Claude Code installer does
      not ship it. Fail with a sentence, not a spawn error; consider a
      single-file binary.
- [ ] **Remote sessions** — SSH, WSL, devcontainers, cloud sessions — put the
      agent and the browser on different machines. Document as unsupported, or
      as "forward 8787" where that works.
- [ ] Wire-protocol bump: the app's version-mismatch message tells users to
      "ask your agent to re-read /agent and rewrite it", which is wrong for a
      plugin user. The answer is `/plugin update`.

## Phase 2 — app-side surface work (other repo)

These limit the plugin more than anything in it.

**Landed 2026-09-19/20** (the surface grew from 41 verbs to 68):

- Vertex editing (`geometry.describe`, `vertex.*`).
- The hoop (`document.set`).
- Auto-digitize from a background image (`background.set`, `background.digitize`).
- Separate sewing order and layering (`sequence.move`, `layer.move`).
- Following the user's edits (`scene.changes`, `activity.read`, `wait.change`).
- `stitching.set` for the settings that are not `params` rows.
- `ui.render` for the whole app window.
- The Selector now has a described schema.
- The paste line's Stage 1 clause is in progress (uncommitted as of this entry).

The plugin side was brought up to date to match. It adds a `call_with_file`
tool (and `--file` on the CLI), so an image goes in by path rather than
hand-written base64, and the control plane's body limit now fits a background
image through a shared bridge.

- [ ] **Export, save, import verbs.** Still missing. The thing a filesystem
      agent adds over the in-app experience is "export the DST to `./out`" and
      "import this design". Export already has a path out (`dataUrl`, and
      `--out` on the CLI), and `call_with_file` is now a way in, but images only
      (PNG, JPEG, WebP, GIF), so an SVG import needs its own design.
- [x] **Real input schemas.** The Selector has a described schema (2026-09-20).
      Worth re-running the headless end-to-end check against the real app to
      see whether agents still guess argument names.
- [ ] The `params.set` legality gap (the handoff's largest known gap).
- [ ] `readOnlyHint` is wrong for `history`; `document.rename` reports
      `changed: false` on a real rename.
- [ ] The paste line and `/agent` assume no plugin. One clause — "if you have
      the Stitch Slop plugin, pass this token to its `pair` tool" — makes the
      line right for both kinds of agent.
- [ ] Reference connector: it spends the token before the busy check; its
      `toContent` leaves the transport `id` in; its text says "Allow agent
      connections" where the UI says "Enable Agent Connections".
- [ ] Emit `commands.json` at build time (already a stated requirement in
      `MCP_TRANSPORT_RESEARCH.md`, not implemented). It gives this repo
      something to test the skill's claims against.

## Phase 3 — skills

Ground each in the app's research docs, not in general embroidery lore: a skill
that states a rule the app does not enforce will be confidently wrong.

1. [ ] **Preflight** — "is this ready to sew?" `problems.list` once `settled`,
       density, tiny satins, jumps, hoop fit, a render. Read-only, so it is
       safe, and it is the best first impression.
2. [ ] **Lettering** — `font.list` → `font.load`, minimum sizes, text as a unit.
       Source: `LETTERING_RESEARCH.md`, `TEXT_AS_A_UNIT.md`.
3. [ ] **Patch** — the `patch.make` workflow. Source: `PATCH_BUILDER_RESEARCH.md`,
       `PATCH_BORDER_RESEARCH.md`.
4. [ ] **Thread matching** — map a palette onto the spools the user owns.
5. [ ] **A read-only reviewer subagent** restricted to describe and render
       verbs, so a user can allow it without prompts.
6. [ ] The design skill as an **MCP prompt**, for clients without skills.
7. [ ] Steer toward `limit` and `detail: 'brief'` on big designs; say what a
       render costs.

## Phase 4 — quality and release

- [ ] **Evals** (`claude plugin eval`). At minimum: calls `pair` on the paste
      line instead of writing a bridge; reports `changed: false` honestly; does
      not retry a refusal (the test agent did, once); ignores instructions
      hidden in an object name; never tells the user to press something.
- [ ] **A faithful stand-in tab.** `test/fake-tab.mjs` answers three verbs with
      canned replies, which is too crude for evals. `createRegistry(ctx)` is a
      pure function of what it is handed; a headless tab running the real
      registry is the right fixture.
- [ ] **CI**: `npm test` and the conformance suite on macOS, Linux, Windows,
      current Node LTS versions. The conformance suite SKIPs with exit 0 when
      8787–8790 are busy — CI must treat a skip as a failure.
- [ ] Upstream the two-tab, ping and image checks into the app's conformance
      suite; the spec (§7) lists them as untested.
- [ ] Release process: protected `main`, tagged versions, `version` bumped in
      `plugin.json` on every release, `CHANGELOG.md`.
- [ ] A compatibility table: plugin version ↔ wire protocol ↔ minimum Claude
      Code version.

## Phase 5 — public documentation

The README is written for someone building the plugin. A user needs:

- [ ] A quickstart with screenshots, and a page on stitchslop.com that the
      Agent panel links to.
- [ ] **Privacy, stated plainly.** The bridge sends nothing anywhere; there is
      no telemetry. But the design, its names and its renders go to the model
      provider as conversation content, because that is what asking an agent
      about them means.
- [ ] **How to revoke**: the switch off; Forget pairing in the panel; delete
      `~/.stitchslop/pairing.json`; uninstall.
- [ ] A recommended permission allow-list for the read-only verbs, so the first
      session is not a wall of prompts.
- [ ] What the agent cannot do through this connection, so "no command for
      that" is not read as "the app can't".
- [ ] FAQ: the Chrome prompt and why it sounds broader than it is; what "busy"
      and "displaced" mean; two agents on one tab share one undo history.
- [ ] `LICENSE`, `CONTRIBUTING.md`, and a real `author` / `repository` in
      `plugin.json`.

## Later

- The relay for claude.ai and mobile.
- A `.mcpb` bundle for Claude Desktop, if decision 1 goes that way.
- WebMCP (`document.modelContext`), once browsers' agents can use it: the
  registry could register its tools in-page and need no bridge at all. Its
  limits are recorded in `WEBMCP_RESEARCH.md` — results are stringified, there
  is no image content type, and a rejection discards its reason.
