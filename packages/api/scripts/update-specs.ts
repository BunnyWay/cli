/**
 * Downloads the latest OpenAPI specs from Bunny's public endpoints
 * into the local specs/ directory. Run via `bun run api:update`.
 */

const specs = [
  {
    name: "core",
    url: "https://core-api-public-docs.b-cdn.net/docs/v3/public.json",
    out: "specs/core.json",
  },
  {
    name: "compute",
    url: "https://core-api-public-docs.b-cdn.net/docs/v3/compute.json",
    out: "specs/compute.json",
  },
  {
    name: "magic-containers",
    url: "https://api-mc.opsbunny.net/docs/public/swagger.json",
    out: "specs/magic-containers.json",
  },
  {
    name: "database",
    url: "https://api.bunny.net/database/docs/private/api.json",
    out: "specs/database.json",
  },
];

console.log("Fetching latest OpenAPI specs...\n");

await Promise.all(
  specs.map(async ({ name, url, out }) => {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`  ✗ ${name} — ${res.status} ${res.statusText}`);
      return;
    }
    await Bun.write(out, await res.text());
    console.log(`  ${name} → ${out}`);
  }),
);

console.log("\nDone. Run `bun run api:generate` to regenerate types.");
