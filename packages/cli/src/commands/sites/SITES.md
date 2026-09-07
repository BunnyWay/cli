# `bunny sites`

> **Experimental**: hidden from `--help` and the landing page while it stabilizes.

Host static sites on bunny.net. Each site is two resources provisioned and wired together for you: a **storage zone** holding the files and a **pull zone** serving them over the CDN, with edge rules that route requests to the deploy that should answer them. Zones are named `sites-<name>-<suffix>` (the prefix groups them in the dashboard; the suffix is because zone names are global across bunny.net) while commands take the clean site name.

Deploys are immutable: every `sites deploy` uploads to its own `deploys/<id>/` directory and then goes live. Publishing retargets the pull zone's rewrite rule and purges the cache, so going live and rolling back to any earlier deploy are instant and move no files. HTML is served with `max-age=0` so browsers pick up new deploys immediately, while static assets get a one-day browser cache. Deploy IDs are the git short SHA when the working tree is clean and a content hash otherwise, which makes redeploying identical content a no-op.

Commands take the site as an optional positional (`[site]`), except `deploy`, `ci init`, and `deployments publish`, which use `--site`. Either accepts the site name or its storage zone ID. When omitted, the site resolves from the directory's linked site (`.bunny/site.json`, written by `sites link` or by `create`/`deploy`), then `sites.name` in `bunny.jsonc`, then an interactive picker that offers to link. Non-interactive runs (`--output json`, no TTY, or `--force` on a destructive command) error instead of prompting.

```bash
# Provision a site
bunny sites create                                    # interactive: prompts for a name (directory-name suggestion)
bunny sites create my-site                            # served at sites-my-site-<suffix>.b-cdn.net
bunny sites create my-site --region NY                # store the files in New York (default: DE)
bunny sites create my-site --domain example.com       # also attach a custom production domain

# Deploy
bunny sites deploy                                    # detects the framework, offers to build, then deploys
bunny sites deploy ./dist                             # deploy a directory and publish it as the live site
bunny sites deploy --build                            # run `sites.build` from bunny.jsonc (else the detected build), then deploy
bunny sites deploy --build "npm run build" --env API_URL=https://api.example.com
bunny sites deploy ./dist --site my-site --force      # target a site explicitly; redeploy unchanged content
bunny sites deploy ./catalog --deploy-id 20260827-1433-r42   # your own release ID instead of the git sha / content hash

# Deploys: list, publish (roll back), prune
bunny sites deployments list                          # ● Live / ○ Previous markers, created, source, files, size
bunny sites deployments publish a1b2c3d4              # promote a past deploy (alias: promote)
bunny sites deployments publish --previous            # instant rollback
bunny sites deployments prune --keep 10               # delete old deploys (default keeps 5; never live/previous)

# Custom production domains
bunny sites domains list
bunny sites domains add shop.example.com              # prints the DNS record to create
bunny sites domains add shop.example.com --wait       # add, wait for DNS, then issue SSL and force HTTPS
bunny sites domains add shop.example.com --ssl --no-force-ssl   # issue SSL now, keep HTTP available
bunny sites domains ssl shop.example.com
bunny sites domains remove shop.example.com --force

# Inspect, open, and force HTTPS on the b-cdn.net system host
bunny sites list                                      # alias: ls
bunny sites show                                      # resources, domains, SSL state, current deploy
bunny sites open --print
bunny sites ssl --no-force-ssl

# CI, linking, maintenance
bunny sites ci init                                   # GitHub Actions: push to main goes live
bunny sites ci init --framework astro
bunny sites link my-site
bunny sites unlink
bunny sites delete my-site --keep-storage             # typed-name confirmation; keeps the deploy files
```

**Client-side routing and 404s.** Single-page apps serve `index.html` for extensionless paths that aren't files (a refresh on `/products/42` returns the app with a 200), while missing assets still 404. This is on automatically when the detected framework is a single-page one (Vite, Create React App, React Router, Angular, Vue CLI, Ember, Preact) and the output has a root `index.html` and no `404.html` (a built not-found page wins over the framework heuristic); set `sites.spa` to `true` or `false` in `bunny.jsonc`, or pass `--spa`/`--no-spa` on the deploy, to decide yourself. When neither applies but the output looks client-routed (a single root `index.html` plus scripts), an interactive deploy asks once and saves the answer to `sites.spa`; the flags answer it in scripts. Otherwise a root `404.html` in the output (as Astro, Eleventy, Hugo, and most static generators emit) becomes the site's not-found page, served with a 404 status. The choice is recorded per deploy and follows rollbacks; `sites show` prints the live one.

Preconfigure the `sites` block in `bunny.jsonc` (`name`, `build`, `dir`, `spa`) and a deploy needs no arguments: `bunny sites deploy --build`. `sites ci init` reads the same block, so the generated workflow builds and deploys exactly what the local command does; without it, the framework is detected from `package.json` deps, `Gemfile`, or a `hugo`/`python`/`zola` config file, with the lockfile picking the package manager. `sites create` offers to scaffold the workflow on GitHub repos.

Every deploy publishes: the files land in an immutable `deploys/<id>/` directory and the rewrite rule is pointed at it, so `deployments publish` rolls back to any earlier deploy by moving that pointer, with no files moving and nothing re-uploaded. The ID is the git short-sha when the tree is clean, a content hash otherwise, or whatever `--deploy-id` supplies (letters, digits, `-`, `_`, `.`; 4-64 chars; case-sensitive): a custom ID never aliases onto another deploy's content, and reusing one for different content asks before replacing (`--force` skips the prompt); a replacement clears the old files first, so nothing stale survives. The live deploy and the rollback target are never replaced in place; deploy those under a new ID. Content is root-served, so absolute asset paths work as-is. Direct `/deploys/<id>/` URLs are blocked at the edge. Site state lives at `_bunny/site.json` inside the storage zone (also blocked at the edge); `.bunny/site.json` is only a local pointer, so a fresh clone can `sites link` and pick up where the last machine left off.

| Flag                                   | Commands                                                   | Description                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `--region`, `--domain`                 | `create`                                                   | Main storage region code (default `DE`); custom production domain to attach                                             |
| `--site`                               | `deploy`, `ci init`, `deployments publish`                 | Site name or storage zone ID (defaults to the linked site)                                                              |
| `--build [cmd]`, `--env`, `--env-file` | `deploy`                                                   | Build before deploying (bare flag uses the configured or detected build); build-time env overrides                      |
| `--force`                              | `deploy`                                                   | Deploy even when the content is unchanged, and replace an existing `--deploy-id` without asking                         |
| `--deploy-id`                          | `deploy`                                                   | Identify the deploy yourself (release tag, catalog ID); case-sensitive, used exactly as given                           |
| `--spa`, `--no-spa`                    | `deploy`                                                   | Serve `index.html` for client-side routes, or the 404 page; beats `sites.spa` and framework detection, skips the prompt |
| `--previous`                           | `deployments publish`                                      | Publish the previous deploy (instant rollback)                                                                          |
| `--keep`                               | `deployments prune`                                        | Number of recent deploys to keep (default 5; live and previous are always kept)                                         |
| `--ssl`, `--wait`, `--force-ssl`       | `domains add`                                              | Issue SSL now; wait up to 10 minutes for DNS then issue it; `--no-force-ssl` keeps HTTP working                         |
| `--force-ssl`                          | `ssl`                                                      | Force HTTP→HTTPS on the system host; `--no-force-ssl` allows plain HTTP                                                 |
| `--framework`                          | `ci init`                                                  | Framework preset for the workflow's build steps (default: detected)                                                     |
| `--print`                              | `open`                                                     | Print the URL instead of opening a browser                                                                              |
| `--link`                               | `create`, `deploy`, `show`, `ci init`, `deployments`       | Link the directory to the site; `--no-link` never links                                                                 |
| `--keep-storage`                       | `delete`                                                   | Delete the pull zone but keep the storage zone and its deploy files                                                     |
| `--force`, `-f`                        | `deployments publish`, `prune`, `domains remove`, `delete` | Skip the confirmation prompts                                                                                           |
