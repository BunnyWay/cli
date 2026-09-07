# @bunny.net/tools

bunny.net operations defined once and shared by every surface. The bunny.net CLI wraps them in commands, a tool server publishes them to an agent, and your own code can import them directly.

A tool is `{ name, description, schema, kind, run(ctx, input) }`. It calls the bunny.net API and returns plain data. It never prompts, never prints, and never assumes a terminal, so the host decides how to ask, confirm, and render.

## Install

```bash
bun add @bunny.net/tools
```

The package uses `node:` builtins only, so it runs on Node as well.

The root entrypoint carries the framework: `defineTool`, `createToolContext`, the catalog, and the schema helpers. Each resource lives on its own subpath, so `@bunny.net/tools/registries` gives you the registries tools and their result types without pulling in the rest.

## Quick start

```ts
import { createToolContext } from "@bunny.net/tools";
import { registriesList } from "@bunny.net/tools/registries";

const ctx = createToolContext({
  apiKey: process.env.BUNNYNET_API_KEY,
  onProgress: (message) => console.error(message),
});

const registries = await registriesList.invoke(ctx, {});
```

`invoke` validates the input against the tool's schema before anything reaches the network, and rejects with a `UserError` that names the offending field. `run` skips validation for callers that already hold typed input.

The context creates API clients on first use and reuses them, so a tool that calls no API runs with no credentials at all. Pass `clients` to inject fakes in tests:

```ts
const ctx = createToolContext({ clients: { mc: fakeMcClient } });
```

## Defining a tool

```ts
import { z } from "zod";
import { defineTool } from "@bunny.net/tools";

export const registriesGet = defineTool({
  name: "registries.get",
  title: "Get a container registry",
  description: "Get one container registry by ID.",
  schema: z.strictObject({
    registry: z.number().int().positive().describe("Registry ID, e.g. `1155`."),
  }),
  kind: "read",
  resultSchema: RegistrySchema,
  run: async (ctx, { registry }) => toRegistry(await fetchRegistry(ctx.clients.mc, registry)),
});
```

`schema` is an object schema, and every field carries `.describe()`. That text is what an agent reads when it picks arguments, so write it for a reader who has never seen the API.

The rest of the definition tells the host how to treat the tool:

- `kind` is `read`, `write`, or `destructive`. A `read` touches nothing and is safe to run unattended. A `write` creates or updates remote state, and calling it is usually intent enough. A `destructive` tool deletes data or cannot be undone, so hosts confirm before running one. The CLI refuses to run a destructive tool without a confirmation gate.
- `resultSchema` declares the shape `run` resolves with. Hosts publish it as the output schema or render it as docs; the package does not re-validate results against it.
- `sensitive` marks a result that carries credentials, so a host can mask it or keep it out of a transcript.
- `localFiles` marks a tool whose path inputs refer to the machine it runs on. A remote host should leave these out.

Names are dotted and lowercase with the verb last: `registries.list`, `registries.delete`. Duplicates throw when the catalog loads.

## The catalog

```ts
import { getTool, listTools, runTool, tools } from "@bunny.net/tools";

listTools({ kind: "read" }); // safe to run unattended
listTools({ namespace: "registries" }); // one resource
listTools({ localFiles: false }); // everything a remote host can offer
await runTool("registries.get", ctx, { registry: 1155 });
```

## Publishing tools to a host

A host that exposes tools over a protocol needs a name, a description, and JSON Schema for the arguments and the result. The package derives all four from the definition:

```ts
import {
  describeTool,
  flatName,
  inputJsonSchema,
  outputJsonSchema,
  toStructuredResult,
  tools,
} from "@bunny.net/tools";

const published = tools.map((tool) => ({
  name: flatName(tool, "bunny"), // registries.list -> bunny_registries_list
  title: tool.title,
  description: describeTool(tool),
  inputSchema: inputJsonSchema(tool),
  outputSchema: outputJsonSchema(tool),
}));

const result = await tool.invoke(ctx, args);
const structured = toStructuredResult(tool, result);
```

`describeTool` folds the examples and the `sensitive` and `localFiles` caveats into the description, for protocols with no field of their own. Most protocols require structured output to be a JSON object, so array results are wrapped as `{ result: [...] }` by both `outputJsonSchema` and `toStructuredResult`, and the two always agree.

How `kind` maps onto a protocol's annotations is the host's call. `read` is the read-only hint, `destructive` is the one to gate, and `write` sits in between.

## Tools

| Tool                | Kind        | Notes                                     |
| ------------------- | ----------- | ----------------------------------------- |
| `registries.list`   | read        | Container registries for Magic Containers |
| `registries.get`    | read        | By registry ID                            |
| `registries.create` | write       | Type derived from `server` when omitted   |
| `registries.update` | write       | Credentials rotate together; name merges  |
| `registries.delete` | destructive | Fails while apps still use the registry   |

## Result shapes

Tools return normalised, credential-free data with camelCase keys and `null` for absent values, whatever casing the underlying API uses. Each shape is a Zod schema (`RegistrySchema`, for example) with the TypeScript type inferred from it, so the CLI's `--output json`, a tool server's output schema, and your type checker all read from one source.
