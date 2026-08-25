# Sites config examples

Drop-in `bunny.jsonc` files for `bunny sites`. Each one preconfigures the
`sites` block so a deploy needs no flags: the CLI reads the site to target, the
build command to run, and the directory to upload straight from the file.

## The `sites` block

| Field   | Purpose                                                                                             | Required |
| ------- | --------------------------------------------------------------------------------------------------- | -------- |
| `name`  | Links the directory to a site (created with `bunny sites create <name>`), so deploys skip `--site`. | No       |
| `build` | The command `bunny sites deploy --build` runs before uploading.                                     | No       |
| `dir`   | The directory that gets uploaded. Defaults to the detected framework's output dir, then the cwd.    | No       |

Every field is optional, and the whole block is optional. A file with only a
`sites` block validates fine: `app` is not required. (`$schema` points at the
JSON Schema for editor autocompletion; it resolves once `@bunny.net/cli` is
installed.)

## What "preconfigured" buys you

With `name`, `build`, and `dir` set, the entire deploy is one command:

```bash
bun ny sites deploy --build            # runs `build`, uploads `dir`, to a preview URL
bun ny sites deploy --build            # same, published as the live site
```

No `--site`, no build command, no directory argument. Without the config you'd
type them each time:

```bash
bun ny sites deploy dist --build "npm run build" --site acme-app
```

## Examples

| Directory                           | Framework               | `build`         | `dir`    |
| ----------------------------------- | ----------------------- | --------------- | -------- |
| [`vite/`](./vite)                   | Vite                    | `npm run build` | `dist`   |
| [`astro/`](./astro)                 | Astro                   | `npm run build` | `dist`   |
| [`nextjs-static/`](./nextjs-static) | Next.js (static export) | `npm run build` | `out`    |
| [`hugo/`](./hugo)                   | Hugo                    | `hugo --minify` | `public` |
| [`static-html/`](./static-html)     | Plain HTML (no build)   | -               | `.`      |
| [`app-and-site/`](./app-and-site)   | Magic Containers + site | `npm run build` | `dist`   |

`app-and-site/` shows both blocks in one file: `bunny apps deploy` reads `app`,
`bunny sites deploy` reads `sites`, and each ignores the other.

## Typical setup

```bash
bun ny sites create acme-app     # provision the site + set `sites.name`
# ...author bunny.jsonc from one of these examples...
bun ny sites deploy --build
```

For other frameworks, set `dir` to the framework's output folder (Gatsby
`public`, SvelteKit `build`, Eleventy `_site`, ...); the CLI also detects most of
these automatically when `dir` is omitted.
