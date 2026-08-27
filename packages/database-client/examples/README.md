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

## Magic Containers

Every example except the edge script ships a `Dockerfile`, and each container listens on port 3000. From inside one:

```bash
bunny apps deploy --dockerfile
```

That builds for `linux/amd64` (the only architecture Magic Containers runs), pushes to the bunny.net registry, and deploys. Give the app its credentials rather than baking them into the image:

```bash
bunny apps env set BUNNY_DATABASE_URL "libsql://your-database.lite.bunnydb.net"
bunny apps env set BUNNY_DATABASE_AUTH_TOKEN "your-token"
```

By hand instead, using your API key as the password:

```bash
docker login registry.bunny.net --username token
docker build --platform linux/amd64 --tag registry.bunny.net/<account-id>/notes:latest .
docker push registry.bunny.net/<account-id>/notes:latest
```

`bunny registry push notes:latest` does the same without needing your account ID.

To ship on every push to `main`:

```yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - run: npm install -g @bunny.net/cli

      - run: docker build --platform linux/amd64 --tag notes:${{ github.sha }} .

      - run: bunny registry push notes:${{ github.sha }}
        env:
          BUNNYNET_API_KEY: ${{ secrets.BUNNYNET_API_KEY }}

      - uses: BunnyWay/actions/container-update-image@main
        with:
          app_id: ${{ vars.APP_ID }}
          api_key: ${{ secrets.BUNNYNET_API_KEY }}
          container: app
          image_tag: ${{ github.sha }}
```
