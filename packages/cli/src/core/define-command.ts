import type { CommandModule, Argv } from "yargs";
import type { GlobalArgs } from "./types.ts";
import { logger } from "./logger.ts";

interface CommandDef<A = {}> {
  command: string;
  aliases?: readonly string[];
  describe: string;
  /** Define command-specific flags and positional arguments. */
  builder?: (yargs: Argv) => Argv<A>;
  /**
   * Runs before the handler. Use for validation that should prevent execution.
   * Throw {@link UserError} to abort with a clean message.
   */
  preRun?: (args: A & GlobalArgs) => Promise<void>;
  /** Main command handler. Global flags (`profile`, `verbose`, `output`) are always available on `args`. */
  handler: (args: A & GlobalArgs) => Promise<void>;
  /** Runs after the handler. Use for cleanup. */
  postRun?: (args: A & GlobalArgs) => Promise<void>;
}

/**
 * Command factory for leaf commands. Wraps the handler with consistent
 * error handling and lifecycle hooks (`preRun` → `handler` → `postRun`).
 *
 * Errors are caught and formatted based on `--output`:
 * - **text** — Human-readable messages via `logger`, with optional hints and validation details.
 * - **json** — Structured `{ error, hint?, status?, field?, validationErrors? }` to stdout.
 *
 * Exit codes: `1` for user/API errors, `2` for unexpected errors.
 *
 * @example
 * ```ts
 * export const myCommand = defineCommand<{ name: string }>({
 *   command: "create <name>",
 *   describe: "Create a thing.",
 *   handler: async ({ name, profile }) => {
 *     const config = resolveConfig(profile);
 *     // ...
 *   },
 * });
 * ```
 */
export function defineCommand<A>(def: CommandDef<A>): CommandModule {
  return {
    command: def.command,
    aliases: def.aliases,
    describe: def.describe,
    builder: def.builder as any,
    handler: async (argv) => {
      const args = argv as unknown as A & GlobalArgs;
      try {
        if (def.preRun) await def.preRun(args);
        await def.handler(args);
        if (def.postRun) await def.postRun(args);
      } catch (err: any) {
        const isUser = err?.isUserError;
        const isApi = err?.name === "ApiError";

        if (args.output === "json") {
          const payload: Record<string, unknown> = {
            error: err?.message ?? "An unexpected error occurred.",
          };
          if (isUser && err.hint) payload.hint = err.hint;
          if (isApi) {
            payload.status = err.status;
            if (err.field) payload.field = err.field;
            if (err.validationErrors?.length) payload.validationErrors = err.validationErrors;
          }
          console.log(JSON.stringify(payload));
          process.exit(isUser ? 1 : 2);
        }

        if (isApi && err.validationErrors?.length) {
          logger.error(err.message);
          for (const ve of err.validationErrors) {
            logger.dim(`  ${ve.field ?? "unknown"}: ${ve.message}`);
          }
          process.exit(1);
        }

        if (isUser) {
          logger.error(err.message);
          if (err.hint) logger.dim(err.hint);
          process.exit(1);
        }

        logger.error("An unexpected error occurred.");
        if (args.verbose) console.error(err);
        process.exit(2);
      }
    },
  };
}
