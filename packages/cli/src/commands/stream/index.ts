import { defineNamespace } from "../../core/define-namespace.ts";
import { streamLibraryNamespace } from "./library/index.ts";
import { streamLinkCommand } from "./link.ts";
import { streamUnlinkCommand } from "./unlink.ts";
import { streamUploadCommand } from "./upload.ts";
import { streamVideoNamespace } from "./videos/index.ts";

export const streamNamespace = defineNamespace("stream", false, [
  streamLibraryNamespace,
  streamVideoNamespace,
  streamUploadCommand,
  streamLinkCommand,
  streamUnlinkCommand,
]);
