/**
 * The two non-CLI surfaces, side by side.
 *
 *   bun run packages/actions/examples/registry-tour.ts
 *
 * Set BUNNYNET_API_KEY to also run an action that talks to the API.
 */
import {
  actions,
  createActionContext,
  listActions,
  runAction,
} from "../src/index.ts";
import { toMcpTools } from "../src/mcp.ts";

// Surface 1: an agent importing the registry as its curated tool set.
console.log("Registry:");
for (const action of actions) {
  const flag = action.destructive ? "destructive" : "read-only";
  console.log(`  ${action.name.padEnd(22)} ${flag.padEnd(12)} ${action.title}`);
}

// An agent running unattended can take the safe half of the registry.
const unattended = listActions({ destructive: false }).map((a) => a.name);
console.log(`\nSafe to run unattended: ${unattended.join(", ")}\n`);

// Surface 2: what an MCP server would answer tools/list with.
const tool = toMcpTools().find((t) => t.name === "bunny_storage_zones_create");
console.log("MCP tool descriptor for storage.zones.create:");
console.log(JSON.stringify(tool, null, 2));

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
