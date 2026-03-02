import { z } from "zod";

export const ProfileSchema = z.object({
  api_key: z.string(),
  api_url: z.string().optional(),
});

export const ConfigFileSchema = z.object({
  log_level: z.string().optional(),
  profiles: z.record(z.string(), ProfileSchema).default({}),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type ConfigFile = z.infer<typeof ConfigFileSchema>;
