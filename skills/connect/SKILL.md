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
3. Otherwise call `wait_for_connection`, passing the `Origin` from the arguments
   when there is one. A line with an origin and no token is a browser that is
   already paired, and needs nothing more.
4. When it returns the design, tell the user what you can see and ask what they
   want to do. Change nothing until they say.
5. If it does not connect, call `connection_status` and follow
   `troubleshooting.md` in the design skill. Ask the user what their Agent panel
   says — its own words are the best evidence.
