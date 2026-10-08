---
"@bunny.net/cli": minor
"@bunny.net/database-shell": patch
---

The CLI now reports its state to the terminal with the program status protocol (OSC 7501): working, waiting on a prompt or browser login, done, or failed, with upload progress for `bunny stream video upload`. Terminals such as Ghostty and Rex show it; others ignore it. Set `BUNNYNET_NO_PROGRAM_STATUS` to turn it off. `@bunny.net/database-shell` gains `onIdle`/`onBusy` shell options.
