#!/usr/bin/env bun

import { cli } from "./cli.ts";
import { checkForUpdate } from "./core/update-check.ts";

await cli.parse();
await checkForUpdate();
