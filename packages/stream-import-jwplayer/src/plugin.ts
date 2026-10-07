import type { SourceContext, SourcePlugin } from "@bunny.net/stream-import";
import { z } from "zod";
import { JWPlayerAdapter } from "./adapter.ts";
import { JWPlayerClient } from "./client.ts";
import type { JWPlayerConfig } from "./types.ts";

export const jwplayerConfigSchema = z.object({
  apiKey: z.string().min(1),
  siteId: z.string().min(1),
});

export const jwplayerSource: SourcePlugin<JWPlayerConfig> = {
  id: "jwplayer",
  label: "JW Player",
  dedupTag: "jwPlayerId",
  supportsFolders: false,
  credentials: [
    {
      key: "apiKey",
      label: "API Key (v2)",
      env: "JWPLAYER_API_KEY",
      secret: true,
      required: true,
      hint: "https://dashboard.jwplayer.com",
    },
    {
      key: "siteId",
      label: "Site ID",
      env: "JWPLAYER_SITE_ID",
      secret: false,
      required: true,
    },
  ],
  configSchema: jwplayerConfigSchema,
  createAdapter: (config: JWPlayerConfig, ctx: SourceContext) =>
    new JWPlayerAdapter(new JWPlayerClient(config, ctx)),
};
