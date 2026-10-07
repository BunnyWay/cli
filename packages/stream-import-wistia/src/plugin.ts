import type { SourceContext, SourcePlugin } from "@bunny.net/stream-import";
import { z } from "zod";
import { WistiaSourceAdapter } from "./adapter.ts";
import { WistiaClient } from "./client.ts";
import type { WistiaConfig } from "./types.ts";

export const wistiaConfigSchema = z.object({
  accessToken: z.string().min(1),
});

export const wistiaSource: SourcePlugin<WistiaConfig> = {
  id: "wistia",
  label: "Wistia",
  dedupTag: "wistiaId",
  supportsFolders: true,
  credentials: [
    {
      key: "accessToken",
      label: "API Token",
      env: "WISTIA_ACCESS_TOKEN",
      secret: true,
      required: true,
      hint: "Wistia > Account > API Access",
    },
  ],
  configSchema: wistiaConfigSchema,
  createAdapter: (config: WistiaConfig, ctx: SourceContext) =>
    new WistiaSourceAdapter(new WistiaClient(config, ctx)),
};
