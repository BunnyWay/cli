import { resolveConfig } from "@/config/index.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { formatDateTime, formatKeyValue } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { toolContext } from "@/core/tool-context.ts";
import type { OutputFormat } from "@/core/types.ts";
import { withSpinner } from "@/core/ui.ts";
import {
  PREVIEW_SIGNED_MAX_SECONDS,
  PREVIEWABLE_STATUSES,
  type PreviewAccess,
  streamLivePreview,
  streamLivePreviewSign,
} from "@/tools/stream/index.ts";
import {
  LIVE_PREVIEW_EPILOGUE,
  parseDuration,
  resolveLiveTarget,
  withStreamPositional,
} from "./shared.ts";

interface LivePreviewArgs {
  stream?: string;
  lib?: string;
  sign?: boolean;
  expires?: string;
}

/** Seconds until a self-signed token expires, from `--expires`: 1 minute to 10h05m. */
export function signedExpiry(value: string | undefined): number {
  const seconds = parseDuration(value ?? "1h", "expires");
  if (seconds < 60 || seconds > PREVIEW_SIGNED_MAX_SECONDS) {
    throw new UserError(
      `--expires must be between 1m and 10h5m (${PREVIEW_SIGNED_MAX_SECONDS} seconds).`,
    );
  }
  return seconds;
}

/** The limits that apply to this access, one line each. */
export function previewLimits(access: PreviewAccess): string[] {
  const until = formatDateTime(access.expiresAt);
  const lines = [
    `Valid until ${until} or until the stream goes public, whichever comes first; then the player switches to the public view.`,
    access.method === "api"
      ? "Access from the API lasts at most 10 hours. Request a new one after it expires."
      : "Signed with the stream key: rotating the key (`bunny stream live rotate-key`) invalidates it at once.",
  ];
  if (access.method === "signed" && !access.playlistUrl) {
    lines.push(
      "No raw playlist URL: with CDN token authentication it would also need a CDN token. Use the player URL, or run without --sign for a signed playlist.",
    );
  }
  lines.push(
    "A forged or expired token is ignored, not rejected: the viewer just sees the public, not-yet-live view. Referrer and view-token checks still apply.",
  );
  return lines;
}

function formatAccess(access: PreviewAccess, output: OutputFormat): string {
  return formatKeyValue(
    [
      { key: "Player", value: access.playerUrl },
      { key: "Player page", value: access.playUrl },
      { key: "Playlist (HLS)", value: access.playlistUrl ?? "-" },
      {
        key: "Expires",
        value: formatDateTime(access.expiresAt),
      },
      {
        key: "Issued by",
        value:
          access.method === "api"
            ? "API (option 1)"
            : "Signed with the stream key (option 2)",
      },
    ],
    output,
  );
}

export const streamLivePreviewCommand = defineCommand<LivePreviewArgs>({
  command: "preview [stream]",
  describe:
    "Get a token-protected link to watch a live stream privately before it goes public.",
  examples: [
    [
      "$0 stream live preview 0f4e5d6c-...",
      "Option 1 (recommended): request access from the API",
    ],
    [
      "$0 stream live preview 0f4e5d6c-... --sign --expires 2h",
      "Option 2: sign a token locally with the stream key, valid for 2 hours",
    ],
    [
      "$0 stream live preview 0f4e5d6c-... --output json",
      "JSON, including playerQuery for your own player integration",
    ],
  ],
  epilogue: `Option 1 (default) asks the API for preview access: it works with the library key or its read-only key, includes the view token when the library requires one, returns a CDN-signed playlist, and lasts 10 hours. Option 2 (--sign) signs a token with the stream key (HMAC-SHA256), so it needs no preview request, expires when you choose (up to 10h05m), and stops working when the key is rotated; it adds no view token or playlist. Either way the stream must be Created, Scheduled or in Preview, and access ends when it goes public.\n\n${LIVE_PREVIEW_EPILOGUE}`,

  builder: (yargs) =>
    withStreamPositional(yargs)
      .option("sign", {
        type: "boolean",
        default: false,
        describe:
          "Option 2: sign the preview token locally with the stream key instead of requesting it from the API",
      })
      .option("expires", {
        type: "string",
        describe:
          "With --sign: how long the token is valid, e.g. 30m or 2h (default 1h, max 10h5m)",
      }),

  preRun: async ({ sign, expires }) => {
    if (expires !== undefined && !sign)
      throw new UserError(
        "--expires only applies with --sign.",
        "Access from the API always lasts 10 hours, or until the stream goes public.",
      );
    if (sign) signedExpiry(expires);
  },

  handler: async (args) => {
    const { profile, apiKey, verbose, output } = args;
    const ctx = toolContext(resolveConfig(profile, apiKey, verbose), {
      verbose,
    });
    const { library, streamId } = await resolveLiveTarget(ctx, args, {
      eligible: (stream) => PREVIEWABLE_STATUSES.includes(stream.status),
      none: "No live streams are waiting to go public.",
    });
    const target = { library: library.id, stream: streamId };

    const access = args.sign
      ? await withSpinner("Signing preview access...", () =>
          streamLivePreviewSign.invoke(ctx, {
            ...target,
            expiresIn: signedExpiry(args.expires),
          }),
        )
      : await withSpinner("Requesting preview access...", () =>
          streamLivePreview.invoke(ctx, target),
        );

    // The command exists to hand over the link, so it prints in full.
    if (output === "json") {
      logger.log(JSON.stringify(access, null, 2));
      return;
    }

    logger.log(formatAccess(access, output));
    logger.log();
    logger.warn(
      "Anyone with this link can watch the preview until it expires. Share it only with people who should see the stream early.",
    );
    if (access.viewTokenMissing) {
      logger.warn(
        "This library requires embed view tokens: add token and expires to the player URL, or run without --sign to have the API include them.",
      );
    }
    for (const line of previewLimits(access)) logger.dim(line);
  },
});
