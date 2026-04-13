#!/usr/bin/env bun

import { cli } from "./cli.ts";
import {
  notifyIfUpdateAvailable,
  scheduleUpdateCheck,
} from "./core/update-check.ts";

notifyIfUpdateAvailable();
await cli.parse();
scheduleUpdateCheck();
