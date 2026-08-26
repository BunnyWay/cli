# Node

Needs Node 24 or newer, which runs the TypeScript file as-is and reads `--env-file`.

```bash
npm install
cp .env.example .env
npm start
```

Listens on http://localhost:3000.

```bash
curl -s localhost:3000/notes
curl -s localhost:3000/notes -H 'content-type: application/json' -d '{"title":"First note"}'
```
