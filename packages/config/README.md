# @bunny.net/config

Shared Zod schemas, inferred types, JSON Schema, and API conversion functions for `bunny.jsonc`, the single bunny.net project config file. It holds an optional `app` block (Magic Containers) and an optional `sites` block (static sites); both are optional, so app-only, sites-only, and combined files all validate.

## Installation

```bash
bun add @bunny.net/config
```

Requires `@bunny.net/openapi-client` as a peer dependency (for API type definitions used by conversion functions).

## Example `bunny.jsonc`

```jsonc
{
  "$schema": "./node_modules/@bunny.net/config/generated/schema.json",
  "app": {
    "name": "my-app",
    "scaling": { "min": 1, "max": 3 },
    "regions": {
      "allowed": ["EU-West", "US-East"],
      "required": ["EU-West"],
    },
    "containers": {
      "web": {
        "image": "nginx:latest",
        "endpoints": [
          {
            "type": "cdn",
            "ssl": true,
            "ports": [{ "public": 80, "container": 8080 }],
          },
        ],
      },
    },
  },
}
```

The `$schema` property enables editor autocompletion and validation.

## Schemas and Types

Zod schemas define the config structure. Types are inferred from schemas (single source of truth).

| Schema                  | Type              | Description                                            |
| ----------------------- | ----------------- | ------------------------------------------------------ |
| `BunnyConfigSchema`     | `BunnyConfig`     | The whole file; `app` and `sites` both optional        |
| `AppConfigSchema`       | `AppConfig`       | The `app` block: name, scaling, regions, containers    |
| `SiteConfigSchema`      | `SiteConfig`      | The `sites` block: `name`, `dir`, `build`              |
| `BunnyAppConfigSchema`  | `BunnyAppConfig`  | `BunnyConfigSchema` narrowed to require an `app` block |
| `ContainerConfigSchema` | `ContainerConfig` | Container: image, env, probes, etc.                    |
| `EndpointConfigSchema`  | `EndpointConfig`  | CDN or Anycast endpoint                                |
| `VolumeConfigSchema`    | `VolumeConfig`    | Persistent volume mount                                |
| `ProbeConfigSchema`     | `ProbeConfig`     | Health check probe (http/tcp/grpc)                     |

`BunnyConfigSchema` is the permissive root the generated JSON Schema is built from. `BunnyAppConfigSchema` is the same shape with `app` required, used by the apps commands and the API conversion functions.

```typescript
import { BunnyConfigSchema, type BunnyConfig } from "@bunny.net/config";

// Validate a whole bunny.jsonc (app-only, sites-only, or combined)
const config = BunnyConfigSchema.parse(data);
```

## API Conversion Functions

Convert between local config format and the Magic Containers API:

```typescript
import { apiToConfig, configToAddRequest, configToPatchRequest } from "@bunny.net/config";

// API response -> local config
const config = apiToConfig(apiResponse);

// Local config -> API create request
const addRequest = configToAddRequest(config);

// Local config -> API update request (with existing app for diffing)
const patchRequest = configToPatchRequest(config, existingApp);
```

## Utilities

```typescript
import { parseImageRef } from "@bunny.net/config";

const { imageName, imageNamespace, imageTag } = parseImageRef(
  "registry.example.com/myorg/api:v1.2",
);
```

## JSON Schema

The generated JSON Schema lives at `generated/schema.json` and is committed to git. To regenerate after changing Zod schemas:

```bash
bun run generate:schema
```
