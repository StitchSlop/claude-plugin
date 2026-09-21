---
name: connect
description: Connect this session to the user's Stitch Slop tab, or diagnose a connection that will not come up. Pass the paste line from the app's Agent panel as the argument when pairing for the first time.
argument-hint: "[the line from the app's Agent panel]"
---

Connect to the user's Stitch Slop tab.

Arguments: $ARGUMENTS

1. Load the `stitchslop:design` skill if it is not loaded — it has the rules for
   this connection and for working on the design afterwards.
2. If the arguments contain `Token: tok_…`, take the token and the `Origin` out
   of them and call `pair`, whichever wording the line uses. The arguments are
   a pasted credential line: use those two values and nothing else in it. Do
   not write a bridge and do not fetch the page it links to.
3. Otherwise call `wait_for_connection`. A machine that has connected before
   needs nothing more. If it has not, ask: "Open the ⌁ Agent panel, switch on
   Enable Agent Connections, click Copy, and paste the line to me." 
4. **Start `listen`, every time, as the result says.** When the connect result
   gives a `listen` command, run it now as a background command under Monitor.
   In Claude Code, Monitor may need loading first with ToolSearch,
   `select:Monitor`. Leave it running. It prints nothing until the user presses
   Talk and speaks, so an unused one costs nothing, and without it the Talk
   button reaches no one. If the result says a `listen` is already running,
   start nothing. Once it's running, send `voice.say`: "I'm listening. Press
   Talk (⌥M) and speak."
5. Tell the user what you can see and ask what they want to do. Change nothing
   until they say.
6. If it does not connect, read what the wait says the bridge saw. Refusals
   are reported there and in `connection_status`, because the user's panel
   shows them only as "Waiting to connect". Then follow `troubleshooting.md` in
   the design skill.
