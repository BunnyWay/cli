# @bunny.net/actions

Headless bunny.net operations, defined once and reused by every surface.

An action is `{ name, description, schema, kind, run(ctx, input) }`. It does the API work and returns plain data. It never prompts, never prints, and never assumes a terminal.

- **The CLI** wraps actions in yargs commands and adds the UX: flags, prompts, spinners, confirmations, tables.
- **A tool server or service** wraps them as callable tools. Zod becomes JSON Schema mechanically, and `kind` becomes whatever that protocol calls its annotations.
- **An agent** imports the registry directly as its curated tool set.

The package only uses `node:` builtins, so it runs on Bun and Node alike.

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
  kind: "read",
  resultSchema: StorageZoneSchema,
  run: async (ctx, { zone }) => toStorageZone(await resolveStorageZone(ctx.clients.core, zone)),
});
```

`schema` is an object schema and every field carries `.describe()`: that text is what an agent reads when choosing arguments.

Every action declares metadata the host uses to decide how to run it:

- `kind` is `read` (touches nothing, safe unattended), `write` (creates or updates remote state; invoking it is normally intent enough), or `destructive` (deletes data or cannot be undone; hosts confirm first). The CLI refuses to run a destructive action without a confirmation gate.
- `resultSchema` declares the shape `run` resolves with. It is not re-validated at runtime; a host can publish it as the action's output schema or render it as docs.
- `sensitive` marks results containing credentials (`storage.zones.credentials`, `db.tokens.create`).
- `localFiles` marks actions whose path inputs refer to the local filesystem (`storage.files.upload`, `storage.files.download`). A remote host should exclude them.

Names follow `resource[.subresource].verb`: the segment before the verb is the resource the action operates on (`db.list`, `storage.zones.list`, `db.tokens.create`).

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

listActions({ kind: "read" }); // safe to run unattended
listActions({ namespace: "storage.zones" }); // one resource
listActions({ localFiles: false }); // everything a remote host can offer
await runAction("storage.zones.get", ctx, { zone: "my-assets" });
```

Names are dotted, lowercase, and unique; duplicates throw at import time.

## Publishing actions as tools

A host that exposes actions over a wire protocol needs a name, a description, and JSON Schema for the arguments and the result. The package derives all four:

```ts
import {
  actions,
  describeAction,
  flatName,
  inputJsonSchema,
  outputJsonSchema,
  toStructuredResult,
} from "@bunny.net/actions";

const tools = actions.map((action) => ({
  name: flatName(action, "bunny"), // storage.zones.list -> bunny_storage_zones_list
  title: action.title,
  description: describeAction(action),
  inputSchema: inputJsonSchema(action),
  outputSchema: outputJsonSchema(action),
}));

const result = await action.invoke(ctx, args);
const structured = toStructuredResult(action, result);
```

`describeAction` folds the examples plus the `sensitive` and `localFiles` caveats into the description, for protocols with no field for them. Structured output is usually required to be a JSON object, so array results are wrapped as `{ result: [...] }` in both `outputJsonSchema` and `toStructuredResult`.

Mapping `kind` is the host's call: `read` is the safe, annotate-as-read-only case, `destructive` is the one to confirm or gate, and `write` sits between them.

## Seeing it work

```bash
bun run packages/actions/examples/registry-tour.ts   # add BUNNYNET_API_KEY to include a live call
```

Prints the registry an agent would import, the tool definition a server would publish for one action, and runs an action through the same entry point the CLI uses.

## Current actions

| Action                      | Kind        | Notes                                        |
| --------------------------- | ----------- | -------------------------------------------- |
| `storage.regions.list`      | read        | Static; needs no credentials                 |
| `storage.zones.list`        | read        | Optional `search` filter                     |
| `storage.zones.get`         | read        | Accepts a name or numeric ID                 |
| `storage.zones.create`      | write       | Region enum is published in the schema       |
| `storage.zones.update`      | write       | Replication merges; additions are permanent  |
| `storage.zones.delete`      | destructive | Deletes every file in the zone               |
| `storage.zones.credentials` | read        | Sensitive; returns the zone password in full |
| `storage.files.list`        | read        | Not recursive                                |
| `storage.files.upload`      | write       | Local files; overwrites the remote path      |
| `storage.files.download`    | read        | Local files; streams to disk                 |
| `storage.files.delete`      | destructive | Trailing slash deletes a directory           |
| `db.list`                   | read        | Live status and region names resolved        |
| `db.get`                    | read        | By database ID                               |
| `db.create`                 | write       | Storage region derived when omitted          |
| `db.delete`                 | destructive | Returns the URL for .env cleanup             |
| `db.usage`                  | read        | Rows, queries, latency, storage              |
| `db.tokens.create`          | write       | Sensitive; token is shown once               |
| `db.tokens.invalidate`      | destructive | Revokes every token at once                  |
| `db.regions.available`      | read        | Primary, replica, and storage sets           |
| `db.regions.suggest`        | read        | Probes the nearest bunny.net edge            |
| `db.regions.list`           | read        | A database's current placement               |
| `db.regions.set`            | destructive | Removing a region drops its data copy        |
| `registries.list`           | read        | Container registries for Magic Containers    |
| `registries.get`            | read        | By registry ID                               |
| `registries.create`         | write       | Type derived from `server` when omitted      |
| `registries.update`         | write       | Credentials rotate together; name merges     |
| `registries.delete`         | destructive | Fails while apps still use the registry      |

## Result shapes

Actions return normalized, credential-free data (`StorageZone`, `Database`) rather than raw API models: camelCase keys, region codes resolved to names, storage-zone passwords stripped. Each shape is defined as a Zod schema (`StorageZoneSchema`, `DatabaseSchema`, ...) with the TypeScript type inferred from it, so the same source of truth backs the CLI's `--output json`, a tool server's output schema, and an agent's type checking.

## Known trade-offs in this PoC

- Commands that resolve a resource interactively (`storage zones show`, `storage zones remove`) pass the resolved ID back into the action, which re-fetches it. That costs one extra request versus the pre-action code, in exchange for the action being the only place that knows how to fetch a zone.
- `--output json` for the wired commands emits the normalized shape instead of the raw API model. That is the point of the layer, but it is a breaking change for anyone parsing the old field names.
- `resultSchema` is declarative only; results are not validated against it at runtime, so an upstream API change shows up as drift rather than an error.
