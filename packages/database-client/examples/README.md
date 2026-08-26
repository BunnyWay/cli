# Examples

The same notes API, a few ways. Each directory has its own README.

Runtimes:

| Example                         | Runtime              |
| ------------------------------- | -------------------- |
| [`bun/`](./bun)                 | Bun                  |
| [`node/`](./node)               | Node 24+             |
| [`hono/`](./hono)               | Bun or Deno          |
| [`edge-script/`](./edge-script) | Bunny Edge Scripting |

Frameworks, each serving the API from a server route so the token never reaches the browser:

| Example                     | Framework |
| --------------------------- | --------- |
| [`next/`](./next)           | Next.js   |
| [`astro/`](./astro)         | Astro     |
| [`sveltekit/`](./sveltekit) | SvelteKit |

Working in this repo? The root `bun install` links the four runtime examples to the local client, so skip their `npm install`. The framework ones stay out of the workspace and install the published client themselves.

First you need a database:

```bash
npm install -g @bunny.net/cli
bunny login
bunny db create
```

That offers to write `BUNNY_DATABASE_URL` and `BUNNY_DATABASE_AUTH_TOKEN` into `.env`. Every example ships an `.env.example` if you would rather paste them in yourself.

The edge script covers full CRUD. The others do less on purpose, so the runtime wiring stays the interesting part.
