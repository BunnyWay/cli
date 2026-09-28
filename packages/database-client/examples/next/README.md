# Next.js

```bash
npm install
cp .env.example .env
bunny db shell -e "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '')"
npm run dev
```

`next dev` loads `.env` into `process.env`, so `connect()` takes no arguments. Both entry points run on the server only, which is where the token has to stay.

`app/page.tsx` is a server component that reads the table, with a server action beside it that writes to it and calls `revalidatePath`. Open http://localhost:3000 and add a note.

`app/api/notes/route.ts` serves the same data over HTTP:

```bash
curl -s localhost:3000/api/notes
curl -s localhost:3000/api/notes -H 'content-type: application/json' -d '{"title":"First note"}'
```

`agentRules: false` in `next.config.mjs` stops `next dev` writing its own AGENTS.md and CLAUDE.md here.

There is a `Dockerfile` here: `bunny apps deploy --dockerfile` puts it on [Magic Containers](../README.md#magic-containers).
