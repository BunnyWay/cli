import type { SourceContext, SourcePlugin } from "@bunny.net/stream-import";
import { z } from "zod";
import { BrightcoveAdapter } from "./adapter.ts";
import { BrightcoveClient } from "./client.ts";
import type { BrightcoveConfig } from "./types.ts";

export const brightcoveConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  accountId: z.string().min(1),
});

export const brightcoveSource: SourcePlugin<BrightcoveConfig> = {
  id: "brightcove",
  label: "Brightcove",
  dedupTag: "brightcoveId",
  supportsFolders: true,
  credentials: [
    {
      key: "clientId",
      label: "Client ID",
      env: "BRIGHTCOVE_CLIENT_ID",
      secret: true,
      required: true,
      hint: "https://studio.brightcove.com/admin/oauthclient (CMS video read)",
    },
    {
      key: "clientSecret",
      label: "Client Secret",
      env: "BRIGHTCOVE_CLIENT_SECRET",
      secret: true,
      required: true,
    },
    {
      key: "accountId",
      label: "Account ID",
      env: "BRIGHTCOVE_ACCOUNT_ID",
      secret: false,
      required: true,
    },
  ],
  configSchema: brightcoveConfigSchema,
  createAdapter: (config: BrightcoveConfig, ctx: SourceContext) =>
    new BrightcoveAdapter(new BrightcoveClient(config, ctx)),
};
