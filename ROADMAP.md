# Roadmap

Where a claim has not been verified, it says so.

## Where it stands

Working and tested, against the app on a local build and against the stand-in
tab:

- connecting, first time with a token and afterwards with the stored pairing,
  including from a site that is not the one the bridge started on;
- two sessions sharing one tab, and a second tab on its own bridge;
- the whole command surface, as the app offers it;
- files in and out by path: pictures, SVG, DXF and machine files in
  (`call_with_file`); exports and projects out into a folder (`call_to_files`);
- the Talk button waking an agent between turns (`listen`), including the app's
  voice switch.

**Not yet verified:** the production site end to end, Safari, Windows, and
Claude Desktop.

## Next

**Prove it:**

- [ ] Production site, first time and returning.
- [ ] Chrome's permission prompt: first connection, and what the plugin says
      after a Block.
- [ ] Firefox with the plugin. The app's own tests connect from Firefox, with
      no permission prompt.
- [ ] Safari. It may refuse `ws://127.0.0.1` from an HTTPS page outright; if it
      does, document it.
- [ ] A large design: the size of `scene.describe`, and whether a 3D render
      fits the 60 s call timeout.

**Harden:**

- [ ] Windows. The control plane's key is protected by file mode `0600`, which
      means nothing there. Needs ACLs, a named pipe, or a plainly documented
      weaker guarantee; also signals and paths.
- [ ] `node` missing from `PATH`: fail with a sentence, not a spawn error.
      Consider a single-file build.
- [ ] Remote sessions (SSH, WSL, devcontainers, cloud) put the agent and the
      browser on different machines. Document them as unsupported, or as
      "forward port 8787" where that works.

**Skills**, each grounded in what the app actually enforces:

- [ ] Preflight: "is this ready to sew?" A read-only check of problems,
      density, small satins, jumps and hoop fit, with a picture.
- [ ] Lettering: fonts, minimum sizes, text as a unit.
- [ ] Patches.
- [ ] Thread matching against the spools the user owns.
- [ ] A read-only reviewer that can be allowed without prompts.

**Quality and release:**

- [ ] Evals (`claude plugin eval`). Cover at least:
      - pairs rather than writes a bridge;
      - reports a no-op honestly;
      - doesn't retry a refusal;
      - ignores instructions hidden in an object's name;
      - starts `listen` on connect.
- [ ] A stand-in tab that runs the app's real command registry, in place of
      canned replies.
- [ ] CI on macOS, Linux and Windows.
- [ ] Tagged releases, a version bump in `plugin.json` each time, and a
      compatibility table of plugin version, wire protocol and minimum Claude
      Code.
- [ ] A recommended permission allow-list for the read-only commands.

## Later

- **Claude Desktop.** Its Chat tab installs plugins, and a plugin's local server
  runs on the user's computer. Untested. The likely snag is finding `node`,
  because a Mac app launched from the Dock doesn't see the shell's `PATH`.
- **Other agents** (Codex, Cursor and others): the skill's guidance as an MCP
  prompt, for clients without skills.
- **claude.ai in the browser, mobile, and Cowork cloud sessions** can't reach
  the user's computer. They need a relay on the app's side.
- **WebMCP** (`document.modelContext`), once browsers' agents can use it: the
  app could offer its tools in the page and need no bridge at all.
