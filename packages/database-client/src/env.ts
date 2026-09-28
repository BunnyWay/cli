export const ENV_DATABASE_URL = "BUNNY_DATABASE_URL";
export const ENV_DATABASE_AUTH_TOKEN = "BUNNY_DATABASE_AUTH_TOKEN";

// Reading can throw rather than return undefined (Deno without --allow-env); treat that as unset.
export function readEnv(name: string): string | undefined {
  try {
    return process.env[name] || undefined;
  } catch {
    return undefined;
  }
}
