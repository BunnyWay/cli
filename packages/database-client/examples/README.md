# Examples

Four takes on the same notes API, one per runtime. Paths are relative to `packages/database-client`.

| Example               | Runtime                     | Run it                                         |
| --------------------- | --------------------------- | ---------------------------------------------- |
| `edge-script/main.ts` | Bunny Edge Scripting (Deno) | `bunny scripts deploy`                         |
| `bun/server.ts`       | Bun                         | `bun run examples/bun/server.ts`               |
| `node/server.ts`      | Node 24 or newer            | `node --env-file=.env examples/node/server.ts` |
| `hono/server.ts`      | Bun, Deno, Edge Scripting   | `bun run examples/hono/server.ts`              |

The edge script is the full CRUD surface: list, create, read, replace, delete. The other three cover fewer routes on purpose, so what you are reading is the runtime wiring rather than a fourth copy of the same handlers.

## Before you run one

Every example calls `connect()` with no arguments, so it needs `BUNNY_DATABASE_URL` and `BUNNY_DATABASE_AUTH_TOKEN` in the environment. `bunny db link` writes both into `.env`:

```bash
bunny db link
```

Bun loads `.env` on its own. Node needs `--env-file=.env`. Edge Scripting takes the variables from the script's own environment, so there is nothing to load.

## Copying one out of this repo

```bash
bun add @bunny.net/database-client
```

The Hono example also needs `hono`. The edge script imports through `npm:` specifiers, so it installs nothing.

## About the schema

Each example creates its table at startup with `CREATE TABLE IF NOT EXISTS`, which keeps a demo to one file. Reach for `bunny db migrations` for a schema you intend to change.
