/**
 * What a host other than the CLI sees: the registry, an action's published
 * schema, and a run through the same entry point the CLI uses.
 *
 *   bun run packages/actions/examples/registry-tour.ts
 *
 * Set BUNNYNET_API_KEY to also run an action that talks to the API.
 */
import {
  actions,
  createActionContext,
  describeAction,
  flatName,
  inputJsonSchema,
  listActions,
  outputJsonSchema,
  requireAction,
  runAction,
} from "../src/index.ts";

// Surface 1: an agent importing the registry as its curated tool set.
console.log("Registry:");
for (const action of actions) {
  console.log(
    `  ${action.name.padEnd(22)} ${action.kind.padEnd(12)} ${action.title}`,
  );
}

// An agent running unattended can take the read-only slice of the registry,
// minus anything that returns credentials or touches the local filesystem.
const unattended = listActions({ kind: "read", localFiles: false })
  .filter((action) => !action.sensitive)
  .map((a) => a.name);
console.log(`\nSafe to run unattended: ${unattended.join(", ")}\n`);

// Surface 2: what a tool server would publish for one action.
const create = requireAction("storage.zones.create");
console.log(`Tool definition for ${create.name}:`);
console.log(
  JSON.stringify(
    {
      name: flatName(create, "bunny"),
      title: create.title,
      description: describeAction(create),
      inputSchema: inputJsonSchema(create),
      outputSchema: outputJsonSchema(create),
    },
    null,
    2,
  ),
);

// Both surfaces call the same entry point, with the same validation.
const ctx = createActionContext({
  apiKey: process.env.BUNNYNET_API_KEY,
  userAgent: "bunny-actions-example/0.1.0",
  onProgress: (message) => console.error(`  ...${message}`),
});

console.log("\nstorage.regions.list (no credentials needed):");
console.log(await runAction("storage.regions.list", ctx, {}));

if (process.env.BUNNYNET_API_KEY) {
  console.log("\nstorage.zones.list:");
  console.log(await runAction("storage.zones.list", ctx, {}));
} else {
  console.log("\nSet BUNNYNET_API_KEY to run storage.zones.list.");
}

// Invalid input is rejected before any request goes out.
await runAction("storage.zones.get", ctx, { zone: "" }).catch((err) =>
  console.log(`\nRejected before hitting the API: ${err.message}`),
);
