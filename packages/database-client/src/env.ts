export const ENV_DATABASE_URL = "BUNNY_DATABASE_URL";
export const ENV_DATABASE_AUTH_TOKEN = "BUNNY_DATABASE_AUTH_TOKEN";

export function readEnv(name: string): string | undefined {
  const deno = (
    globalThis as { Deno?: { env?: { get(key: string): string | undefined } } }
  ).Deno;
  if (deno?.env?.get) {
    try {
      const value = deno.env.get(name);
      if (value) return value;
    } catch {
      // No env permission.
      // Fall through to process.env, then to the caller's error.
    }
  }

  const proc = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process;
  return proc?.env?.[name] || undefined;
}
