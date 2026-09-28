# Astro

```bash
npm install
cp .env.example .env
bunny db shell -e "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '')"
npm run dev
```

Astro puts `.env` on `import.meta.env` rather than `process.env`, so both values go to `connect()` explicitly. They stay on the server: only `PUBLIC_` variables reach the browser, and the token is not one of them.

`src/pages/index.astro` queries the table from its frontmatter and handles the form POST there too. Open http://localhost:4321 and add a note.

`src/pages/api/notes.ts` serves the same data over HTTP:

```bash
curl -s localhost:4321/api/notes
curl -s localhost:4321/api/notes -H 'content-type: application/json' -d '{"title":"First note"}'
```

`prerender = false` is what makes both run per request, and the node adapter is what `astro build` needs to output a server.

There is a `Dockerfile` here: `bunny apps deploy --dockerfile` puts it on [Magic Containers](../README.md#magic-containers).
