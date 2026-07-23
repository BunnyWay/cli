# @bunny.net/actions

Headless bunny.net operations, defined once and reused by every surface.

An action is `{ name, description, schema, destructive, run(ctx, input) }`. It does the API work and returns plain data. It never prompts, never prints, and never assumes a terminal.

- **The CLI** wraps actions in yargs commands and adds the UX: flags, prompts, spinners, confirmations, tables.
- **An MCP server** wraps them as tools. Zod → JSON Schema is mechanical, and `destructive` becomes the tool annotation.
- **An agent** imports the registry directly as its curated tool set.

## Defining an action

```ts
import { z } from "zod";
import { defineAction } from "@bunny.net/actions";

export const storageZonesGet = defineAction({
  name: "storage.zones.get",
  title: "Get a storage zone",
  description:
    "Get one storage zone by name or ID, including replication regions and S3 compatibility.",
  schema: z.strictObject({
    zone: z
      .string()
      .min(1)
      .describe("Storage zone name or numeric ID, e.g. `my-assets` or `123456`."),
  }),
  destructive: false,
  run: async (ctx, { zone }) => toStorageZone(await resolveStorageZone(ctx.clients.core, zone)),
});
```

`schema` is an object schema and every field carries `.describe()`: that text is what an agent reads when choosing arguments. `destructive` is declared by hand for anything that creates, mutates, or deletes.

## Running one

```ts
import { createActionContext, storageZonesList } from "@bunny.net/actions";

const ctx = createActionContext({
  apiKey: process.env.BUNNYNET_API_KEY,
  onProgress: (message) => console.error(message),
});

const zones = await storageZonesList.invoke(ctx, { search: "assets" });
```

`invoke` validates the input against the schema before running and rejects with a `UserError` naming the bad field. `run` is the unvalidated escape hatch when the caller already has typed input.

The context creates API clients lazily and memoizes them, so an action that calls no API (`storage.regions.list`) works with no credentials at all. Pass `clients` to inject fakes:

```ts
const ctx = createActionContext({ clients: { core: fakeCoreClient } });
```

## The registry

```ts
import { actions, getAction, listActions, runAction } from "@bunny.net/actions";

listActions({ destructive: false }); // safe to run unattended
listActions({ namespace: "storage.zones" }); // one resource
await runAction("storage.zones.get", ctx, { zone: "my-assets" });
```

Names are dotted, lowercase, and unique; duplicates throw at import time.

## MCP tools

```ts
import { actionForToolName, toMcpTools } from "@bunny.net/actions/mcp";

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: toMcpTools() }));

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const action = actionForToolName(params.name);
  if (!action) throw new Error(`Unknown tool: ${params.name}`);
  const result = await action.invoke(ctx, params.arguments);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});
```

`storage.zones.list` becomes `bunny_storage_zones_list`, with `readOnlyHint: true`. `storage.zones.delete` becomes `bunny_storage_zones_delete`, with `destructiveHint: true`, and the host decides what to do about that.

## Seeing it work

```bash
bun run packages/actions/examples/registry-tour.ts   # add BUNNYNET_API_KEY to include a live call
```

Prints the registry an agent would import, the MCP descriptor a server would return for `tools/list`, and runs an action through both.

## Current actions

| Action                 | Destructive | Notes                                  |
| ---------------------- | ----------- | -------------------------------------- |
| `storage.regions.list` | no          | Static; needs no credentials           |
| `storage.zones.list`   | no          | Optional `search` filter               |
| `storage.zones.get`    | no          | Accepts a name or numeric ID           |
| `storage.zones.create` | yes         | Region enum is published in the schema |
| `storage.zones.delete` | yes         | Deletes every file in the zone         |
| `db.list`              | no          | Live status and region names resolved  |
| `db.get`               | no          | By database ID                         |

## Result shapes

Actions return normalized, credential-free data (`StorageZone`, `Database`) rather than raw API models: camelCase keys, region codes resolved to names, storage-zone passwords stripped. That shape is the contract the CLI's `--output json`, an MCP tool result, and an agent all see.

## Known trade-offs in this PoC

- Commands that resolve a resource interactively (`storage zones show`, `storage zones remove`) pass the resolved ID back into the action, which re-fetches it. That costs one extra request versus the pre-action code, in exchange for the action being the only place that knows how to fetch a zone.
- `--output json` for the wired commands now emits the normalized shape instead of the raw API model. That is the point of the layer, but it is a breaking change for anyone parsing the old field names.
