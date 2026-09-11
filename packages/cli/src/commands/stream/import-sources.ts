import type { SourcePlugin } from "@bunny.net/stream-import";
import { brightcoveSource } from "@bunny.net/stream-import-brightcove";
import { cloudflareSource } from "@bunny.net/stream-import-cloudflare";
import { jwplayerSource } from "@bunny.net/stream-import-jwplayer";
import { muxSource } from "@bunny.net/stream-import-mux";
import { s3Source } from "@bunny.net/stream-import-s3";
import { vimeoSource } from "@bunny.net/stream-import-vimeo";
import { wistiaSource } from "@bunny.net/stream-import-wistia";
import { UserError } from "@/core/errors.ts";

/** The CLI's only per-source knowledge: `--source` choices, prompts, and env resolution all derive from this list. */
export const SOURCES: SourcePlugin[] = [
  vimeoSource,
  s3Source,
  wistiaSource,
  muxSource,
  cloudflareSource,
  jwplayerSource,
  brightcoveSource,
];

export const SOURCE_IDS: string[] = SOURCES.map((s) => s.id);

export function findSource(id: string): SourcePlugin | undefined {
  return SOURCES.find((s) => s.id === id);
}

export function requireSource(id: string | undefined): SourcePlugin {
  if (!id) {
    throw new UserError(
      "No source selected.",
      `Pass --source <${SOURCE_IDS.join("|")}>.`,
    );
  }

  const plugin = findSource(id);
  if (!plugin) {
    throw new UserError(
      `Unknown source: ${id}`,
      `Available sources: ${SOURCE_IDS.join(", ")}.`,
    );
  }

  return plugin;
}
