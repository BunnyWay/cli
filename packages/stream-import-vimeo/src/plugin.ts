import type { SourceContext, SourcePlugin } from "@bunny.net/stream-import";
import { z } from "zod";
import { VimeoSourceAdapter } from "./adapter.ts";
import { VimeoClient } from "./client.ts";
import type { VimeoConfig } from "./types.ts";

export const vimeoConfigSchema = z.object({
  accessToken: z.string().min(1),
});

export const vimeoSource: SourcePlugin<VimeoConfig> = {
  id: "vimeo",
  label: "Vimeo",
  dedupTag: "vimeoId",
  supportsFolders: true,
  credentials: [
    {
      key: "accessToken",
      label: "Access Token",
      env: "VIMEO_ACCESS_TOKEN",
      secret: true,
      required: true,
      hint: "https://developer.vimeo.com/apps (scopes: public, private, video_files)",
    },
  ],
  configSchema: vimeoConfigSchema,
  createAdapter: (config: VimeoConfig, ctx: SourceContext) =>
    new VimeoSourceAdapter(new VimeoClient(config, ctx), ctx),
};
