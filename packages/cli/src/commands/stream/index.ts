import { defineNamespace } from "@/core/define-namespace.ts";
import { streamCaptionNamespace } from "./caption/index.ts";
import { streamCollectionNamespace } from "./collection/index.ts";
import { streamEncodeNamespace } from "./encode/index.ts";
import { streamLibraryNamespace } from "./library/index.ts";
import { streamSmartCommand } from "./smart.ts";
import { streamTranscribeCommand } from "./transcribe.ts";
import { streamVideoNamespace } from "./video/index.ts";

export const streamNamespace = defineNamespace("stream", false, [
  streamLibraryNamespace,
  streamVideoNamespace,
  streamCollectionNamespace,
  streamCaptionNamespace,
  streamEncodeNamespace,
  streamTranscribeCommand,
  streamSmartCommand,
]);
