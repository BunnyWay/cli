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

| You pass…                | What happens                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `<image>` positional     | Skip build. Resolve a registry record for the image hostname (prompting if needed) and deploy the ref.            |
| `--dockerfile [path]`    | Build from the Dockerfile (defaults to `./Dockerfile`), push to a registry, then deploy.                          |
| Neither                  | Consult `bunny.jsonc`. If `dockerfile` is set on the container, build; otherwise re-deploy the pinned `image`.    |

`<image>` and `--dockerfile` are mutually exclusive.

If no `bunny.jsonc` exists, the first run launches a walkthrough that:

1. Resolves the registry (prompts "is this image public, or do you need credentials?" for new hostnames).
2. Calls bunny.net's image-suggestions endpoint to pre-fill app name, endpoints, and required environment variables for known public images.
3. Prompts for regions.
4. Writes `bunny.jsonc`, creates the app, and deploys.

| Flag             | Description                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `<image>`        | Container image reference to deploy (e.g. `ghcr.io/me/api:v1.2`). Skips build.                                    |
| `--dockerfile`   | Build from a Dockerfile, then deploy. Pass a path or use the bare flag for `./Dockerfile`.                        |
| `--context`      | Docker build context directory. Defaults to the directory of the Dockerfile.                                      |
| `--tag`          | Override the auto-generated `<sha>-<timestamp>` image tag.                                                        |
| `--registry`     | Bunny registry ID to push to. Overrides the value stored in `bunny.jsonc`.                                        |
| `--container`    | Name of the container to update. Required when `bunny.jsonc` has multiple containers and you pass `<image>`/`--dockerfile`. |
| `--no-push`      | Build only — skip pushing the image and skip the deploy.                                                          |

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
```

### Registries during deploy

Every container on Magic Containers is tied to a registry record on bunny.net — even for public images. When you pass `<image>` for the first time, the CLI parses the hostname and tries to match it to an existing registry on your account:

- **Match found** → uses it and saves the registry ID to `bunny.jsonc`.
- **No match** → prompts: "Is this image public, or do you need credentials?" Selecting public creates a credential-less registry record; selecting private prompts for username + token and creates the registry.

Credentials entered during this flow are also passed through to `docker login` (for the build path) so the very next `docker push` succeeds without a separate manual login step.

## `bunny apps init`

Scaffold a new `bunny.jsonc` without deploying. Useful if you want to edit the config before the first deploy. Most users can skip this and run `bunny apps deploy` straight away — it will walk you through setup the first time.

```bash
bunny apps init
bunny apps init --name my-api --image nginx:latest
```

| Flag      | Description                           |
| --------- | ------------------------------------- |
| `--name`  | App name (defaults to directory name) |
| `--image` | Primary container image               |

If a `Dockerfile` is detected in the current directory, `init` offers to wire it up for build-and-deploy.

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

# Set a variable on a specific container
bunny apps env set DATABASE_URL postgres://localhost:5432/mydb --container postgres

# Remove a variable
bunny apps env remove OLD_VAR

# Pull remote vars to .env
bunny apps env pull
```

| Flag          | Description                         |
| ------------- | ----------------------------------- |
| `--container` | Target container (default: primary) |

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
    "id": "app_xxx",                     // written by the CLI on first deploy
    "name": "my-api",
    "regions": ["sfo", "lhr"],           // simple array
    "scaling": { "min": 1, "max": 3 },
    "containers": {
      "api": {
        "image": "ghcr.io/me/api:v1",    // last deployed; rewritten each deploy
        "registry": "12345",             // bunny registry id
        "dockerfile": "Dockerfile",      // optional — enables the build path
        "context": ".",                  // optional — Docker build context
        "env": { "PORT": "3000" },
        "endpoints": [
          { "type": "cdn", "ssl": true, "ports": [{ "public": 443, "container": 3000 }] }
        ]
      }
    }
  }
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
        "env": { "DB_URL": "postgres://db:5432/app" }
      },
      "db": {
        "image": "postgres:16",
        "env": { "POSTGRES_PASSWORD": "..." }
      }
    }
  }
}
```

### Regions: simple form vs advanced

Most users want a single list of regions that the app should run in:

```jsonc
"regions": ["sfo", "lhr"]
```

For the rare case where you need to distinguish "regions Bunny is allowed to use" from "regions Bunny must always have running", use the object form:

```jsonc
"regions": {
  "allowed": ["sfo", "lhr", "nyc"],
  "required": ["sfo"]
}
```

The array form sets both `allowed` and `required` to the same list under the hood.
