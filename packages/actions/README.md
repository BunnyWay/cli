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

Flags: **D** destructive (mutates remote state), **S** sensitive (result carries credentials).

| Action                      | D   | S   | Notes                                        |
| --------------------------- | --- | --- | -------------------------------------------- |
| `storage.regions.list`      |     |     | Static; needs no credentials                 |
| `storage.zones.list`        |     |     | Optional `search` filter                     |
| `storage.zones.get`         |     |     | Accepts a name or numeric ID                 |
| `storage.zones.create`      | ✓   |     | Region enum is published in the schema       |
| `storage.zones.update`      | ✓   |     | Merges replication (removal is impossible)   |
| `storage.zones.delete`      | ✓   |     | Deletes every file in the zone               |
| `storage.zones.credentials` |     | ✓   | Returns the zone password in full            |
| `storage.files.list`        |     |     | One directory, not recursive                 |
| `storage.files.upload`      | ✓   |     | Overwrites; streams from disk                |
| `storage.files.download`    |     |     | Streams to disk, creating parent dirs        |
| `storage.files.delete`      | ✓   |     | Trailing slash deletes a directory tree      |
| `db.list`                   |     |     | Live status and region names resolved        |
| `db.get`                    |     |     | By database ID                               |
| `db.create`                 | ✓   |     | Derives the storage region when omitted      |
| `db.delete`                 | ✓   |     | Returns the URL so callers can clean up env  |
| `db.usage`                  |     |     | Rows, queries, latency, storage over a range |
| `db.regions.available`      |     |     | Primary/replica/storage placement options    |
| `db.regions.suggest`        |     |     | Placement from the caller's edge location    |
| `db.regions.list`           |     |     | A database's current placement               |
| `db.regions.set`            | ✓   |     | Replaces the region set wholesale            |
| `db.tokens.create`          | ✓   | ✓   | Shown once; returns the db URL too           |
| `db.tokens.invalidate`      | ✓   |     | Revokes every token at once                  |

## Result shapes

Actions return normalized, credential-free data (`StorageZone`, `Database`, `StorageFileEntry`) rather than raw API models: camelCase keys, region codes resolved to names, storage-zone passwords stripped, file paths made zone-relative so they feed straight back into the next call. That shape is the contract the CLI's `--output json`, an MCP tool result, and an agent all see. The two `sensitive` actions are the deliberate exception: they return a credential in full, and it is the host's job to mask or withhold it.

## Known trade-offs in this PoC

- Commands that resolve a resource interactively (`storage zones show`, `storage zones remove`) pass the resolved ID back into the action, which re-fetches it. That costs one extra request versus the pre-action code, in exchange for the action being the only place that knows how to fetch a zone.
- `--output json` for the wired commands now emits the normalized shape instead of the raw API model. That is the point of the layer, but it is a breaking change for anyone parsing the old field names.
