# @bunny.net/tools

bunny.net operations defined once and shared by every surface. The CLI wraps them in commands; a future tool server can publish them to an agent.

Internal workspace package, not published. It is consumed as TypeScript source and bundled into the CLI binary, so it has no build step. It stays Node-portable (`node:` builtins only, no `Bun.*` globals) so a tool server can import it unchanged.

A tool is `{ name, description, schema, kind, run(ctx, input) }`. It calls the bunny.net API and returns plain data. It never prompts, never prints, and never assumes a terminal, so the host decides how to ask, confirm, and render.

## Usage

```ts
import { createToolContext } from "@bunny.net/tools";
import { registriesList } from "@bunny.net/tools/registries";

const ctx = createToolContext({ apiKey: process.env.BUNNYNET_API_KEY });
const registries = await registriesList.invoke(ctx, {});
```

`invoke` validates the input against the tool's schema before anything reaches the network, and rejects with a `UserError` naming the offending field. `run` skips validation for callers that already hold typed input.

The context creates API clients on first use and reuses them. Pass `clients` to inject fakes in tests:

```ts
const ctx = createToolContext({ clients: { mc: fakeMcClient } });
```

## Defining a tool

```ts
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

- `kind` is `read`, `write`, or `destructive`. The CLI refuses to run a destructive tool without a confirmation gate.
- `resultSchema` declares the shape `run` resolves with. Hosts publish it as the output schema; results are not re-validated against it.
- `sensitive` marks a result carrying credentials. `localFiles` marks a tool whose paths refer to the machine it runs on.

Names are dotted and lowercase with the verb last: `registries.list`, `registries.delete`. Duplicates throw when the catalog loads.

## The catalog

```ts
import { getTool, listTools, runTool, tools } from "@bunny.net/tools";

listTools({ kind: "read" }); // safe to run unattended
listTools({ namespace: "registries" }); // one resource
await runTool("registries.get", ctx, { registry: 1155 });
```

## Publishing tools to a host

A host that exposes tools over a protocol needs a name, a description, and JSON Schema for the arguments and the result. `schema.ts` derives all four:

```ts
const published = tools.map((tool) => ({
  name: flatName(tool, "bunny"), // registries.list -> bunny_registries_list
  title: tool.title,
  description: describeTool(tool),
  inputSchema: inputJsonSchema(tool),
  outputSchema: outputJsonSchema(tool),
}));

const structured = toStructuredResult(tool, await tool.invoke(ctx, args));
```

`describeTool` folds the examples and the `sensitive` and `localFiles` caveats into the description. Most protocols require structured output to be a JSON object, so non-object results are wrapped as `{ result }` by both `outputJsonSchema` and `toStructuredResult`, and the two always agree.

How `kind` maps onto a protocol's annotations is the host's call. `read` is the read-only hint, `destructive` is the one to gate, and `write` sits in between.

## Tools

| Tool                    | Kind        | Notes                                     |
| ----------------------- | ----------- | ----------------------------------------- |
| `registries.list`       | read        | Container registries for Magic Containers |
| `registries.get`        | read        | By registry ID                            |
| `registries.create`     | write       | Type derived from `server` when omitted   |
| `registries.update`     | write       | Credentials rotate together; name merges  |
| `registries.delete`     | destructive | Fails while apps still use the registry   |
| `registry.repositories` | read        | bunny.net OCI registry, prefix stripped   |
| `registry.tags`         | read        | Bare repository name in, bare name back   |

`registries` manages the credentials bunny.net uses to pull from third-party registries. `registry` reads the bunny.net registry itself, over the OCI distribution API rather than a generated client, so it uses `ctx.clients.registry`.

## Result shapes

Tools return normalised, credential-free data with camelCase keys and `null` for absent values, whatever casing the underlying API uses. Each shape is a Zod schema (`RegistrySchema`, for example) with the TypeScript type inferred from it, so the CLI's `--output json`, a tool server's output schema, and your type checker all read from one source.
