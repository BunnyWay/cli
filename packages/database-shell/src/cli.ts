#!/usr/bin/env bun

import {
  createShellClient,
  executeFile,
  executeQuery,
  PRINT_MODES,
  startShell,
} from "./index.ts";
import type { PrintMode } from "./types.ts";

function printUsage() {
  console.log(`
  @bunny.net/database-shell — Interactive SQL shell for libSQL databases.

  Usage:
    bsql <url> [options]
    bsql <url> <query>
    bsql <url> <file.sql>

  Options:
    --token <token>     Auth token for the database
    --mode <mode>       Output mode: default, table, json, csv, markdown
    --unmask            Show sensitive column values unmasked
    --timing            Show query execution timing
    --help              Show this help message

  Examples:
    bsql libsql://<your-database>.lite.bunnydb.net --token ey...
    bsql libsql://<your-database>.lite.bunnydb.net "SELECT * FROM users"
    bsql libsql://<your-database>.lite.bunnydb.net seed.sql --mode table
`);
}

function parseArgs(args: string[]) {
  let url: string | undefined;
  let token: string | undefined;
  let mode: PrintMode = "default";
  let unmask = false;
  let timing = false;
  let help = false;
  let queryOrFile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--token" && i + 1 < args.length) {
      token = args[++i];
    } else if (arg === "--mode" && i + 1 < args.length) {
      const m = args[++i];
      if (PRINT_MODES.includes(m as PrintMode)) {
        mode = m as PrintMode;
      } else {
        console.error(
          `Unknown mode: ${m}. Valid modes: ${PRINT_MODES.join(", ")}`,
        );
        process.exit(1);
      }
    } else if (arg === "--unmask") {
      unmask = true;
    } else if (arg === "--timing") {
      timing = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (!url) {
      url = arg;
    } else if (!queryOrFile) {
      queryOrFile = arg;
    }
  }

  return { url, token, mode, unmask, timing, help, queryOrFile };
}

async function main() {
  const { url, token, mode, unmask, timing, help, queryOrFile } = parseArgs(
    process.argv.slice(2),
  );

  if (help || !url) {
    printUsage();
    process.exit(help ? 0 : 1);
  }

  const client = createShellClient({ url, authToken: token });

  const options = { mode, masked: !unmask, timing };

  if (queryOrFile) {
    if (queryOrFile.endsWith(".sql")) {
      await executeFile(client, queryOrFile, options);
    } else {
      await executeQuery(client, queryOrFile, options);
    }
  } else {
    await startShell({ client, ...options });
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
