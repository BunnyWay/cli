# Hono

```bash
npm install
cp .env.example .env
npm start
```

Listens on http://localhost:3000.

```bash
curl -s localhost:3000/notes
curl -s localhost:3000/notes -H 'content-type: application/json' -d '{"title":"First note"}'
curl -s localhost:3000/notes/1
curl -sX DELETE localhost:3000/notes/1
```

`npm start` runs it on Bun. The default export is a fetch handler, so Deno works too:

```bash
deno serve server.ts
```

For Edge Scripting, swap both imports to `npm:` specifiers the way [`edge-script/main.ts`](../edge-script/main.ts) does. A bare package name has nothing to resolve against once the file is up there on its own.
