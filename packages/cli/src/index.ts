#!/usr/bin/env bun

import { cli } from "./cli.ts";
import { checkForUpdate, getLatestVersion } from "./core/update-check.ts";
import { VERSION } from "./core/version.ts";

const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("-V")) {
  console.log(`${VERSION} ${process.platform}-${process.arch}`);
  const latest = await getLatestVersion();
  if (latest && latest !== VERSION) {
    console.log(
      `\nUpdate available: ${VERSION} → ${latest}` +
        `\nRun: npm install -g @bunny.net/cli`,
    );
  }
  process.exit(0);
}

await cli.parse();
await checkForUpdate();
