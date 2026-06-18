import { defineNamespace } from "../../core/define-namespace.ts";
import { storageDocsCommand } from "./docs.ts";
import { storageFileNamespace } from "./file/index.ts";
import {
  storageZoneHiddenAliases,
  storageZoneNamespace,
} from "./zone/index.ts";

export const storageNamespace = defineNamespace("storage", false, [
  storageZoneNamespace,
  storageFileNamespace,
  storageDocsCommand,
  ...storageZoneHiddenAliases,
]);
