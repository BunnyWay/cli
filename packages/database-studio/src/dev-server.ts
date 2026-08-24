/**
 * Standalone dev server for the database-studio API.
 *
 * Usage:
 *   bun run dev:server --url libsql://<ulid>-<name>.lite.bunnydb.net --token ...
 */
import { parseArgs } from "node:util";
import { connect } from "@bunny.net/database-client";
import { startStudio } from "./server.ts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    url: { type: "string" },
    token: { type: "string" },
    port: { type: "string", default: "4488" },
  },
});

if (!values.url) {
  console.error(
    "Usage: bun run dev:server --url <DATABASE_URL> [--token <TOKEN>] [--port <PORT>]",
  );
  process.exit(1);
}

const client = connect({
  url: values.url,
  authToken: values.token,
  headers: { "User-Agent": "bunny-database-studio" },
});

await startStudio({ client, port: Number(values.port), open: false });
