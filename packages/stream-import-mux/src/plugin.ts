import type { SourceContext, SourcePlugin } from "@bunny.net/stream-import";
import { z } from "zod";
import { MuxSourceAdapter } from "./adapter.ts";
import { MuxClient } from "./client.ts";
import type { MuxConfig } from "./types.ts";

export const muxConfigSchema = z.object({
  tokenId: z.string().min(1),
  tokenSecret: z.string().min(1),
});

export const muxSource: SourcePlugin<MuxConfig> = {
  id: "mux",
  label: "Mux",
  dedupTag: "muxAssetId",
  supportsFolders: false,
  credentials: [
    {
      key: "tokenId",
      label: "Token ID",
      env: "MUX_TOKEN_ID",
      secret: true,
      required: true,
      hint: "https://dashboard.mux.com/settings/api-keys",
    },
    {
      key: "tokenSecret",
      label: "Token Secret",
      env: "MUX_TOKEN_SECRET",
      secret: true,
      required: true,
    },
  ],
  configSchema: muxConfigSchema,
  createAdapter: (config: MuxConfig, ctx: SourceContext) =>
    new MuxSourceAdapter(new MuxClient(config, ctx)),
};
