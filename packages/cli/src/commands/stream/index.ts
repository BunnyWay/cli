import { defineNamespace } from "@/core/define-namespace.ts";
import { withPreviewNotice } from "@/core/preview-notice.ts";
import { streamCollectionNamespace } from "./collection/index.ts";
import { streamEncodeNamespace } from "./encode/index.ts";
import { streamImportNamespace } from "./import/index.ts";
import { streamLibraryNamespace } from "./library/index.ts";
import { streamLibraryLinkCommand } from "./library/link.ts";
import { streamLibraryUnlinkCommand } from "./library/unlink.ts";
import { streamRegionsCommand } from "./regions.ts";
import { streamCaptionsHiddenNamespace } from "./video/captions/index.ts";
import { streamVideoNamespace } from "./video/index.ts";
import { streamVideoSmartCommand } from "./video/smart.ts";
import { streamVideoTranscribeCommand } from "./video/transcribe.ts";

export const streamNamespace = withPreviewNotice(
  defineNamespace(
    "stream",
    "Manage Stream video libraries and videos (preview).",
    [
      streamLibraryNamespace,
      streamVideoNamespace,
      streamCollectionNamespace,
      streamImportNamespace,
      streamLibraryLinkCommand,
      streamLibraryUnlinkCommand,
      streamRegionsCommand,
      { ...streamVideoTranscribeCommand, describe: false as never },
      { ...streamVideoSmartCommand, describe: false as never },
      streamEncodeNamespace,
      streamCaptionsHiddenNamespace,
    ],
  ),
  "Stream",
);
