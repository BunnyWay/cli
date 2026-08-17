export const ENV_DATABASE_URL = "BUNNY_DATABASE_URL";
export const ENV_DATABASE_AUTH_TOKEN = "BUNNY_DATABASE_AUTH_TOKEN";

// Runtime sniff: either global may be absent (wrong runtime) or throw on read (Deno without --allow-env).
const g = globalThis as {
  Deno?: { env?: { get(key: string): string | undefined } };
  process?: { env?: Record<string, string | undefined> };
};

export function readEnv(name: string): string | undefined {
  try {
    return g.Deno?.env?.get(name) || g.process?.env?.[name] || undefined;
  } catch {
    return undefined;
  }
}
