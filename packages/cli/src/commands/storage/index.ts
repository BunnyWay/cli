import { defineNamespace } from "../../core/define-namespace.ts";
import { storageDocsCommand } from "./docs.ts";
import { storageFileNamespace } from "./file/index.ts";
import { storageLinkCommand } from "./link.ts";
import { storageRegionsCommand } from "./regions.ts";
import { storageUnlinkCommand } from "./unlink.ts";
import {
  storageZoneHiddenAliases,
  storageZoneNamespace,
} from "./zone/index.ts";

export const storageNamespace = defineNamespace("storage", false, [
  storageZoneNamespace,
  storageFileNamespace,
  storageLinkCommand,
  storageUnlinkCommand,
  storageRegionsCommand,
  storageDocsCommand,
  ...storageZoneHiddenAliases,
]);
