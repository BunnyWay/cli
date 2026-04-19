---
"@bunny.net/database-studio": patch
---

Fix table list overflow on the studio landing page

The initial table list was wrapped in a `h-full` flex container with `items-center justify-center`, sitting inside a `<main>` with `overflow-hidden`. When more tables were present than fit on screen, the centered list overflowed `<main>` and was clipped with no way to scroll. Wrapped the card in `overflow-y-auto` and switched the centering layer to `min-h-full` so it stays vertically centered when content fits and scrolls when it doesn't.
