import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { ConfigFileSchema, type ConfigFile } from "./schema.ts";
import { findConfigFile, getConfigWritePath } from "./paths.ts";
import { logger } from "../core/logger.ts";

export interface ResolvedConfig {
  apiKey: string;
  /** Custom API base URL. Only set when explicitly overridden via env or profile config. */
  apiUrl?: string;
  profile: string;
}

export function resolveConfig(profile: string, apiKeyOverride?: string): ResolvedConfig {
  const envApiUrl = process.env.BUNNYNET_API_URL || undefined;

  if (apiKeyOverride) {
    logger.debug("API key loaded from --api-key flag", true);
    return {
      apiKey: apiKeyOverride,
      apiUrl: envApiUrl,
      profile: "",
    };
  }

  const envApiKey = process.env.BUNNYNET_API_KEY;

  if (envApiKey) {
    logger.debug("API key loaded from BUNNYNET_API_KEY", true);
    return {
      apiKey: envApiKey,
      apiUrl: envApiUrl,
      profile: "",
    };
  }

  const file = loadConfigFile();
  if (file && file.profiles[profile]) {
    const p = file.profiles[profile];
    return {
      apiKey: p.api_key,
      apiUrl: envApiUrl ?? p.api_url,
      profile,
    };
  }

  if (profile === "default") {
    return { apiKey: "", apiUrl: envApiUrl, profile };
  }

  throw new Error(`Profile "${profile}" not found`);
}

export function loadConfigFile(): ConfigFile | null {
  const path = findConfigFile();
  if (!path) return null;

  try {
    const raw = readFileSync(path, "utf-8");
    return ConfigFileSchema.parse(JSON.parse(raw));
  } catch {
    logger.warn(`Failed to parse config file: ${path}`);
    return null;
  }
}

function saveConfigFile(data: ConfigFile, filePath?: string): void {
  const target = filePath ?? getConfigWritePath();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(data, null, 2) + "\n", { mode: 0o660 });
}

export function setProfile(profile: string, apiKey: string): void {
  const existing = loadConfigFile() ?? { profiles: {} };

  existing.profiles[profile] = {
    api_key: apiKey,
  };

  saveConfigFile(existing);
}

export function deleteProfile(profile: string): void {
  const existing = loadConfigFile();
  if (!existing) throw new Error("No config file found");

  delete existing.profiles[profile];
  saveConfigFile(existing);
}

export function profileExists(profile: string): boolean {
  const file = loadConfigFile();
  return !!file?.profiles[profile];
}
