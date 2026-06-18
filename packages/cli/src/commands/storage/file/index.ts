import { defineNamespace } from "../../../core/define-namespace.ts";
import { storageFileDownloadCommand } from "./download.ts";
import { storageFileListCommand } from "./list.ts";
import { storageFileRemoveCommand } from "./remove.ts";
import { storageFileUploadCommand } from "./upload.ts";

export const storageFileNamespace = defineNamespace(
  "files",
  "Manage files within a storage zone: list, upload, download, delete.",
  [
    storageFileListCommand,
    storageFileUploadCommand,
    storageFileDownloadCommand,
    storageFileRemoveCommand,
  ],
  ["file"],
);
