import { defineNamespace } from "@/core/define-namespace.ts";
import { streamLiveBitrateCommand } from "./bitrate.ts";
import { streamLiveCreateCommand } from "./create.ts";
import { streamLiveDeleteCommand } from "./delete.ts";
import { streamLiveIngestCommand } from "./ingest.ts";
import { streamLiveListCommand } from "./list.ts";
import { streamLivePreviewCommand } from "./preview.ts";
import { streamLiveRotateKeyCommand } from "./rotate-key.ts";
import { streamLiveShowCommand } from "./show.ts";
import { streamLiveStartCommand } from "./start.ts";
import { streamLiveStatsCommand } from "./stats.ts";
import { streamLiveStatusCommand } from "./status.ts";
import { streamLiveStopCommand } from "./stop.ts";
import { streamLiveThumbnailCommand } from "./thumbnail.ts";
import { streamLiveUpdateCommand } from "./update.ts";

// Ordered as the lifecycle runs: create, connect, go live, monitor, end.
export const streamLiveNamespace = defineNamespace(
  "live",
  "Create, broadcast and manage live streams.",
  [
    streamLiveCreateCommand,
    streamLiveListCommand,
    streamLiveShowCommand,
    streamLiveIngestCommand,
    streamLivePreviewCommand,
    streamLiveStartCommand,
    streamLiveStatusCommand,
    streamLiveStopCommand,
    streamLiveUpdateCommand,
    streamLiveRotateKeyCommand,
    streamLiveThumbnailCommand,
    streamLiveBitrateCommand,
    streamLiveStatsCommand,
    streamLiveDeleteCommand,
  ],
);
