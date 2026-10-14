import { defineNamespace } from "@/core/define-namespace.ts";
import { streamCaptionNamespace } from "./caption/index.ts";
import { streamCollectionNamespace } from "./collection/index.ts";
import { streamEncodeNamespace } from "./encode/index.ts";
import { streamImportNamespace } from "./import/index.ts";
import { streamLibraryNamespace } from "./library/index.ts";
import { streamLibraryLinkCommand } from "./library/link.ts";
import { streamLibraryUnlinkCommand } from "./library/unlink.ts";
import { streamRegionsCommand } from "./regions.ts";
import { streamVideoNamespace } from "./video/index.ts";
import { streamVideoSmartCommand } from "./video/smart.ts";
import { streamVideoTranscribeCommand } from "./video/transcribe.ts";

export const streamNamespace = defineNamespace(
  "stream",
  "Manage Stream video libraries and videos (preview).",
  [
    streamLibraryNamespace,
    streamVideoNamespace,
    streamCollectionNamespace,
    streamCaptionNamespace,
    streamImportNamespace,
    // The link scopes every stream command, so it is mirrored here as well as under `libraries`.
    streamLibraryLinkCommand,
    streamLibraryUnlinkCommand,
    streamRegionsCommand,
    // Hidden: the old spellings of `videos transcribe`, `videos smart`, and `videos encode`.
    { ...streamVideoTranscribeCommand, describe: false as never },
    { ...streamVideoSmartCommand, describe: false as never },
    streamEncodeNamespace,
  ],
);
