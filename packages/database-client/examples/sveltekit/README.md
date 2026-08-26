# SvelteKit

```bash
npm install
cp .env.example .env
bunny db shell -e "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '')"
npm run dev
```

`$env/dynamic/private` reads `.env` and refuses to be imported from client code, so the token cannot leak into the browser bundle.

```bash
curl -s localhost:5173/api/notes
curl -s localhost:5173/api/notes -H 'content-type: application/json' -d '{"title":"First note"}'
```
