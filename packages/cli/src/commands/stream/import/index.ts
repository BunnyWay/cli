import { defineNamespace } from "@/core/define-namespace.ts";
import { streamImportRunCommand } from "./run.ts";
import { streamImportStatusCommand } from "./status.ts";

// The run is the namespace's default command, so `bunny stream import` imports and `bunny stream import status` reports.
export const streamImportNamespace = defineNamespace(
  "import",
  "Import videos into a Stream library from Vimeo, S3, Wistia, Mux, Cloudflare Stream, JW Player, or Brightcove.",
  [streamImportRunCommand, streamImportStatusCommand],
);
