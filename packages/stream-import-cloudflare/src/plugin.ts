import type { SourceContext, SourcePlugin } from "@bunny.net/stream-import";
import { z } from "zod";
import { CloudflareStreamAdapter } from "./adapter.ts";
import { CloudflareStreamClient } from "./client.ts";
import type { CloudflareConfig } from "./types.ts";

export const cloudflareConfigSchema = z.object({
  apiToken: z.string().min(1),
  accountId: z.string().min(1),
});

export const cloudflareSource: SourcePlugin<CloudflareConfig> = {
  id: "cloudflare",
  label: "Cloudflare Stream",
  dedupTag: "cfStreamId",
  supportsFolders: false,
  credentials: [
    {
      key: "apiToken",
      label: "API Token",
      env: "CLOUDFLARE_API_TOKEN",
      secret: true,
      required: true,
      hint: "https://dash.cloudflare.com/profile/api-tokens (permission: Stream:Read)",
    },
    {
      key: "accountId",
      label: "Account ID",
      env: "CLOUDFLARE_ACCOUNT_ID",
      secret: false,
      required: true,
    },
  ],
  configSchema: cloudflareConfigSchema,
  createAdapter: (config: CloudflareConfig, ctx: SourceContext) =>
    new CloudflareStreamAdapter(new CloudflareStreamClient(config, ctx)),
};
