#!/usr/bin/env bun

import { cli } from "./cli.ts";
import { hintGlobalSkillInstall } from "./commands/skills/offer.ts";
import { checkForUpdate, getLatestVersion } from "./core/update-check.ts";
import { VERSION } from "./core/version.ts";

const args = process.argv.slice(2);
// A bare `-v` means version by muscle memory; with a command it stays the verbose flag.
const bareVerbose = args.length === 1 && args[0] === "-v";
if (args.includes("--version") || args.includes("-V") || bareVerbose) {
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
// Skills commands manage the skill explicitly, so the nudge would be noise there.
if (args[0] !== "skills") hintGlobalSkillInstall();
