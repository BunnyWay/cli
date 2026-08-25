# Astro example

A notes endpoint in an Astro project, served on demand.

> [!IMPORTANT]
> This one needs a server target. Bunny sites serves static output from storage, so an Astro build that queries a database at request time cannot deploy there. Run it wherever you can run a Node process: a Magic Containers app, or your own host. For a database-backed API that deploys to Bunny directly, use the `edge-script` or `hono` example instead.

## Run it

```bash
bun install
bunny db link
bun run dev
```

`bunny db link` writes `BUNNY_DATABASE_URL` and `BUNNY_DATABASE_AUTH_TOKEN` into `.env`, which Astro loads for you.

```bash
curl http://localhost:4321/api/notes
curl -X POST http://localhost:4321/api/notes -d '{"title":"First"}'
```

## What to look at

`src/pages/api/notes.ts` sets `export const prerender = false`. That line is the whole reason this example works: leave it out under a static build and Astro runs the query once during `astro build`, then ships the result as frozen JSON that never changes until the next deploy.

`src/lib/db.ts` calls `connect()` at module scope and exports the `CREATE TABLE` as a promise. Routes await it, so the schema check happens once per server process rather than once per request. A real project uses `bunny db migrations` and drops that file's `ready` export entirely.

The token stays on the server. Astro would happily let you import this client into a component that ships to the browser, which would hand every visitor full access to the database, so keep it in `src/pages/api/` and `src/lib/`.
