import { UserError } from "@bunny.net/openapi-client";
import type { SourcePlugin } from "@bunny.net/stream-import";
import { brightcoveSource } from "@bunny.net/stream-import-brightcove";
import { cloudflareSource } from "@bunny.net/stream-import-cloudflare";
import { jwplayerSource } from "@bunny.net/stream-import-jwplayer";
import { muxSource } from "@bunny.net/stream-import-mux";
import { s3Source } from "@bunny.net/stream-import-s3";
import { vimeoSource } from "@bunny.net/stream-import-vimeo";
import { wistiaSource } from "@bunny.net/stream-import-wistia";

/** Every source a host can import from; choices, prompts, and env resolution all derive from this list. */
export const SOURCES: readonly SourcePlugin[] = [
  vimeoSource,
  s3Source,
  wistiaSource,
  muxSource,
  cloudflareSource,
  jwplayerSource,
  brightcoveSource,
];

export const SOURCE_IDS: string[] = SOURCES.map((s) => s.id);

/** Keys a source otherwise takes from an ambient chain (the AWS default chain for s3), so they count as missing unless the host allows ambient credentials. */
export const AMBIENT_CREDENTIAL_ENV: Readonly<Record<string, string[]>> = {
  s3: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
};

export function findSource(id: string): SourcePlugin | undefined {
  return SOURCES.find((s) => s.id === id);
}

export function requireSource(id: string): SourcePlugin {
  const plugin = findSource(id);
  if (!plugin) {
    throw new UserError(
      `Unknown source: ${id}`,
      `Available sources: ${SOURCE_IDS.join(", ")}.`,
    );
  }

  return plugin;
}
