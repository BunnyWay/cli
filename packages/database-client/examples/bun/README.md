# Bun

```bash
npm install
cp .env.example .env
npm start
```

Bun picks up `.env` on its own. Listens on http://localhost:3000.

```bash
curl -s localhost:3000/notes
curl -s localhost:3000/notes -H 'content-type: application/json' -d '{"title":"First note"}'
curl -s localhost:3000/notes/1
curl -sX DELETE localhost:3000/notes/1
```
