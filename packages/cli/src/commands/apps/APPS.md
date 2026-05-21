# `bunny apps` (Experimental)

Manage apps (Magic Containers). Apps are multi-container deployments where all containers share a localhost network. Configuration is stored in a `bunny.jsonc` file which is committed to your repo. The app ID is written back to the config on first deploy, so cloning the repo gives you everything you need. The JSONC format supports a `$schema` property for editor autocompletion.

```bash
# Deploy a pre-built image (first run walks through setup)
bunny apps deploy ghcr.io/myorg/api:v1.2

# Build the local Dockerfile and deploy
bunny apps deploy --dockerfile

# Re-deploy whatever is in bunny.jsonc
bunny apps deploy

# Sync remote config to local bunny.jsonc
bunny apps pull

# Apply local bunny.jsonc changes to remote
bunny apps push
```

## `bunny apps deploy`

Deploy an app. Three modes, chosen by what you pass:

| You pass…             | What happens                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `<image>` positional  | Skip build. Resolve a registry record for the image hostname (prompting if needed) and deploy the ref.         |
| `--dockerfile [path]` | Build from the Dockerfile (defaults to `./Dockerfile`), push to a registry, then deploy.                       |
| Neither               | Consult `bunny.jsonc`. If `dockerfile` is set on the container, build; otherwise re-deploy the pinned `image`. |

`<image>` and `--dockerfile` are mutually exclusive.

If no `bunny.jsonc` exists, the first run launches a walkthrough that:

1. Looks for a `compose.yml` / `docker-compose.yml` in the working directory and offers to import the services from it.
2. Otherwise offers to build from a `Dockerfile` (if one exists) or to deploy a pre-built image ref.
3. Resolves the registry (prompts "is this image public, or do you need credentials?" for new hostnames).
4. Calls bunny.net's image-suggestions endpoint to pre-fill app name, endpoints, and required environment variables for known public images.
5. Prompts for a single region. Multi-region apps can be configured by editing the resulting `bunny.jsonc`: the schema accepts an array, the walkthrough just keeps the initial setup focused.
6. Writes `bunny.jsonc`, creates the app, and deploys.

After a successful deploy that replaced a running image, the CLI prints the previous image reference and a one-line rollback command:

```
Previous image: ghcr.io/me/api:abc-123
To rollback:    bunny apps deploy ghcr.io/me/api:abc-123
```

### Importing from docker-compose

When you run `bunny apps deploy` in a project containing a `compose.yml` (or `compose.yaml`, `docker-compose.yml`, `docker-compose.yaml`), the walkthrough offers to translate it into `bunny.jsonc`. Each compose `service` becomes a container; the user still picks an app name, region, and registry.

What translates cleanly:

| Compose                                       | bunny.jsonc                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `services.<name>`                             | `app.containers.<name>`                                                          |
| `image:` / `build:`                           | `container.image` / `container.dockerfile` + `container.context`                 |
| `command:` (string or array)                  | `container.command` (array form)                                                 |
| `environment:` (map or array)                 | `container.env`                                                                  |
| `env_file:` (one or many)                     | parsed and merged into `container.env` (env vars in `environment:` override)     |
| `ports:` (`"3000:80"` / object / IP-prefixed) | `container.endpoints[0]` (one CDN endpoint, multiple port mappings)              |
| `volumes:` (named only)                       | `container.volumes`                                                              |
| `healthcheck:`                                | `container.probes.liveness` (HTTP probe if `test` mentions a URL; TCP otherwise) |

What's ignored (warning is printed, translation proceeds):

- `depends_on:`, `networks:`, `links:`, `external_links:` (MC containers share `localhost` and start together)
- `restart:` (MC restarts automatically)
- `labels:` (use bunny.jsonc endpoints for routing)
- `deploy.replicas:` (MC scales at the app level via `app.scaling`, not per-container)
- `profiles:` (not relevant on MC)

What's refused (translation fails with a clear error):

- **Bind mounts** (`./data:/data` or any source starting with `.` / `/`): MC only supports named volumes
- **Anonymous volumes** (`/data` with no source name): ambiguous, give the volume a name in top-level `volumes:`
- `extends:`: flatten the service inline
- `secrets:`: use `bunny apps env push` to store secrets
- `configs:`: bake config into the image or pass via env
- Port ranges (`"3000-3005:3000-3005"`): use individual mappings

For compose files that have just one service, the import overlaps with the Dockerfile build path, but with the user's chosen ports, env, and command already filled in. For multi-service files, this is the canonical entry point.

### Deploy flags

| Flag           | Description                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `<image>`      | Container image reference to deploy (e.g. `ghcr.io/me/api:v1.2`). Skips build.                                              |
| `--name`       | App name. Used during the first-run walkthrough; skips the interactive prompt.                                              |
| `--dockerfile` | Build from a Dockerfile, then deploy. Pass a path or use the bare flag for `./Dockerfile`.                                  |
| `--context`    | Docker build context directory. Defaults to the directory of the Dockerfile.                                                |
| `--tag`        | Override the auto-generated `<sha>-<timestamp>` image tag.                                                                  |
| `--registry`   | bunny.net registry ID to push to. Overrides the value stored in `bunny.jsonc`.                                              |
| `--container`  | Name of the container to update. Required when `bunny.jsonc` has multiple containers and you pass `<image>`/`--dockerfile`. |
| `--port`       | Override the container port. Retargets any endpoints written to `bunny.jsonc`.                                              |
| `--command`    | Override the container `CMD`. Passed as a single string, split on whitespace.                                               |
| `--config`     | Use this file as the app config instead of cwd's `bunny.jsonc`. Useful in CI / agent flows.                                 |
| `--dry-run`    | Run the walkthrough and print the would-be `bunny.jsonc` without writing anything or contacting the API.                    |
| `--no-push`    | Build only. Skip pushing the image and skip the deploy.                                                                     |

```bash
# Deploy a pre-built image
bunny apps deploy ghcr.io/myorg/api:v1.2

# Build ./Dockerfile and deploy
bunny apps deploy --dockerfile

# Build a Dockerfile in a subdirectory with explicit context
bunny apps deploy --dockerfile apps/api/Dockerfile --context apps/api

# Tag the build explicitly (CI workflow with $GITHUB_SHA)
bunny apps deploy --dockerfile --tag ${GITHUB_SHA}

# Build locally for verification but don't push or deploy
bunny apps deploy --dockerfile --no-push

# Preview the would-be config without writing or deploying
bunny apps deploy --dry-run

# Override the container port and start command
bunny apps deploy --port 8000 --command "uvicorn app:app --host 0.0.0.0 --port 8000"

# CI / agent flow: use a config file outside the repo
bunny apps deploy --config /tmp/agent-task-abc.jsonc --output json
```

### Using `--config <path>` for CI and agent workflows

When `--config <path>` is set, that file is treated as the source of truth instead of walking up from cwd looking for `bunny.jsonc`. Semantics:

- **Path exists** → load it (no walkthrough). `app.id` and any other changes are persisted back to the same file.
- **Path doesn't exist** → run the walkthrough as usual, but write the result to the given path instead of `./bunny.jsonc`.
- **`--config` not set + `bunny.jsonc` not detected in cwd** → run the walkthrough and write `./bunny.jsonc` (current behaviour).
- **`--config` not set + `bunny.jsonc` detected in cwd** → use it (current behaviour).

This avoids the "agent has to create a file in cwd" problem for CI environments and ephemeral agent runs. Common pattern:

```bash
# Generate the config at runtime (e.g. with jq, envsubst, or echo)
echo "$CONFIG_JSON" > /tmp/agent-task.jsonc

# Deploy reads + persists to that path
bunny apps deploy --config /tmp/agent-task.jsonc --output json

# ... do work via Tailscale / your container's own endpoints ...

# Clean up
bunny apps delete --force --id $(jq -r .app.id /tmp/agent-task.jsonc)
rm /tmp/agent-task.jsonc
```

### Registries during deploy

Every container on Magic Containers is tied to a registry record on bunny.net, even for public images. When you pass `<image>` for the first time, the CLI parses the hostname and tries to match it to an existing registry on your account:

- **Match found** → uses it and saves the registry ID to `bunny.jsonc`.
- **No match** → prompts: "Is this image public, or do you need credentials?" Selecting public creates a credential-less registry record; selecting private prompts for username + token and creates the registry.

Credentials entered during this flow are also passed through to `docker login` (for the build path) so the very next `docker push` succeeds without a separate manual login step.

### Docker login pre-flight

Before pushing, the CLI checks `~/.docker/config.json` for an existing credential entry for the registry hostname. If none is found:

- **`ghcr.io`**: if the `gh` CLI is installed and authenticated, you'll be offered a one-click login. The CLI runs `gh api user` + `gh auth token` and pipes them through `docker login` for you.
- **Any other host**: you'll be prompted for a username and token, then logged in.

Either path persists in `~/.docker/config.json`, so subsequent deploys skip this step.

## `bunny apps init`

Scaffold a new `bunny.jsonc` without deploying. Runs exactly the same walkthrough as `deploy` (compose import, Dockerfile, or pre-built image). It just stops at "config written" instead of continuing on to build/push/deploy. Use this when you want to inspect or edit the generated config before the first deploy.

```bash
bunny apps init
bunny apps init ghcr.io/me/api:v1
bunny apps init --dockerfile --port 8080
```

| Flag           | Description                                                                          |
| -------------- | ------------------------------------------------------------------------------------ |
| `<image>`      | Pre-built image reference. Skips the build-vs-image prompt.                          |
| `--name`       | App name (skips the interactive name prompt).                                        |
| `--dockerfile` | Build from a Dockerfile. Pass a path or use the bare flag for `./Dockerfile`.        |
| `--registry`   | bunny.net registry ID to push to.                                                    |
| `--port`       | Override the container port (affects the generated Dockerfile and the CDN endpoint). |
| `--command`    | Override the container CMD (passed as a single string, split on whitespace).         |
| `--config`     | Write the config to this path instead of `./bunny.jsonc`.                            |

Most users can skip `init` entirely and run `bunny apps deploy` straight away. Both share the same walkthrough.

## `bunny apps list`

List all apps.

```bash
bunny apps list
bunny apps ls --output json
```

## `bunny apps show`

Show app details including status, regions, scaling, cost, and containers.

```bash
bunny apps show
bunny apps show --id <app-id>
```

## `bunny apps pull` / `bunny apps push`

Sync configuration between the remote API and local `bunny.jsonc`.

```bash
# Pull remote state to local bunny.jsonc
bunny apps pull
bunny apps pull --force

# Push local bunny.jsonc to remote (config only — does not deploy)
bunny apps push
bunny apps push --dry-run
```

## `bunny apps env`

Manage environment variables per container.

```bash
# List vars (primary container)
bunny apps env list

# Set a single variable
bunny apps env set DATABASE_URL postgres://localhost:5432/mydb --container postgres

# Remove a variable
bunny apps env remove OLD_VAR

# Pull remote vars to .env
bunny apps env pull

# Push (bulk import) variables from a .env file. Default file is ./.env.
bunny apps env push
bunny apps env push .env.prod

# Replace all remote variables with the file's contents.
bunny apps env push .env.prod --replace

# Preview the diff without writing.
bunny apps env push --dry-run
```

| Flag          | Description                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `--container` | Target container (default: primary)                                                                    |
| `--replace`   | (`push` only) Drop remote variables that aren't in the file. Default is merge (file overrides remote). |
| `--dry-run`   | (`push` only) Print the diff (`+ added`, `~ changed`, `- removed`) without writing.                    |

## `bunny apps endpoints`

Manage endpoints (CDN or Anycast) per container.

```bash
bunny apps endpoints list
bunny apps endpoints add --type cdn --ssl --container-port 3000 --public-port 443
bunny apps endpoints remove <endpoint-id>
```

## `bunny apps volumes`

Manage persistent volumes.

```bash
bunny apps volumes list
bunny apps volumes remove <volume-id> --force
```

## `bunny apps regions`

View available regions and app region settings.

```bash
bunny apps regions list
bunny apps regions show
```

## `bunny.jsonc` schema

The config carries a `version` field so we can detect and reject older shapes when they no longer match what the CLI expects. Versions are ISO date strings; the CLI throws a clear error if `version` is missing and asks you to regenerate the file via `bunny apps pull`.

A single-container app:

```jsonc
{
  "$schema": "./node_modules/@bunny.net/app-config/generated/schema.json",
  "version": "2026-05-11",
  "app": {
    "id": "app_xxx", // written by the CLI on first deploy
    "name": "my-api",
    "regions": ["sfo", "lhr"], // simple array
    "scaling": { "min": 1, "max": 3 },
    "containers": {
      "api": {
        "image": "ghcr.io/me/api:v1", // last deployed; rewritten each deploy
        "registry": "12345", // bunny registry id
        "dockerfile": "Dockerfile", // optional — enables the build path
        "context": ".", // optional — Docker build context
        "env": { "PORT": "3000" },
        "endpoints": [
          { "type": "cdn", "ssl": true, "ports": [{ "public": 443, "container": 3000 }] },
        ],
      },
    },
  },
}
```

A multi-container app — every container is its own entry in `app.containers`. `bunny apps deploy <image>` and `bunny apps deploy --dockerfile` require `--container <name>` to disambiguate which one to update; `bunny apps deploy` with no args re-triggers a deploy of the whole app at its current state.

```jsonc
{
  "version": "2026-05-11",
  "app": {
    "name": "my-stack",
    "regions": ["sfo"],
    "containers": {
      "api": {
        "image": "ghcr.io/me/api:v1",
        "registry": "12345",
        "env": { "DB_URL": "postgres://db:5432/app" },
      },
      "db": {
        "image": "postgres:16",
        "env": { "POSTGRES_PASSWORD": "..." },
      },
    },
  },
}
```

### Regions: simple form vs advanced

Most users want a single list of regions that the app should run in:

```jsonc
"regions": ["sfo", "lhr"]
```

For the rare case where you need to distinguish "regions bunny.net is allowed to use" from "regions bunny.net must always have running", use the object form:

```jsonc
"regions": {
  "allowed": ["sfo", "lhr", "nyc"],
  "required": ["sfo"]
}
```

The array form sets both `allowed` and `required` to the same list under the hood.
