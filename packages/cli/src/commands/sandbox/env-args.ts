import type { Argv } from "yargs";

// The env parsing lives in core/env.ts; re-exported here so sandbox keeps its import path.
export { collectEnv, parseDotenv, splitPair } from "@/core/env.ts";

/** Add the shared `--env`/`--env-file` options to a command builder.
 *  Pass `{ shortAlias: false }` on commands that forward arbitrary argv so that
 *  `-e` is not consumed by yargs before reaching the remote process. */
export function withEnvOptions<T>(
  yargs: Argv<T>,
  { shortAlias = true }: { shortAlias?: boolean } = {},
): Argv<T> {
  return yargs
    .option("env", {
      ...(shortAlias ? { alias: "e" } : {}),
      type: "string",
      array: true,
      // One value per flag; a greedy array would swallow `-- <command>`.
      nargs: 1,
      describe: "Set an environment variable as KEY=VALUE (repeatable)",
    })
    .option("env-file", {
      type: "string",
      describe: "Load environment variables from a dotenv file",
    });
}

/** Fields yargs populates for the shared env options. */
export interface EnvOptionArgs {
  env?: string[];
  envFile?: string;
}
