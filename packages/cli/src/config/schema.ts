import { z } from "zod";

export const ProfileSchema = z.object({
  api_key: z.string(),
  api_url: z.string().optional(),
});

export const SandboxRecordSchema = z.object({
  app_id: z.string(),
  agent_token: z.string(),
  ssh_host: z.string().nullable().optional(),
});

export const ConfigFileSchema = z.object({
  log_level: z.string().optional(),
  profiles: z.record(z.string(), ProfileSchema).default({}),
  sandboxes: z.record(z.string(), SandboxRecordSchema).default({}),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type ConfigFile = z.infer<typeof ConfigFileSchema>;
export type SandboxRecord = z.infer<typeof SandboxRecordSchema>;
