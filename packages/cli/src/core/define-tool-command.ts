import type { Tool, ToolContext } from "@bunny.net/tools";
import type { Argv, CommandModule } from "yargs";
import type { z } from "zod";
import { resolveConfig } from "@/config/index.ts";
import { defineCommand } from "./define-command.ts";
import { logger } from "./logger.ts";
import { toolContext } from "./tool-context.ts";
import type { GlobalArgs } from "./types.ts";
import { spinner } from "./ui.ts";

/** Returned by {@link ToolCommandDef.prepare} to stop without running the tool. */
export const CANCELLED = Symbol("cancelled");

/** The result of turning CLI arguments into a single tool invocation. */
export interface Prepared<Schema extends z.ZodObject> {
  /** Validated by the tool's schema before it runs. */
  input: z.input<Schema>;
  /** Confirmation gate. Required for destructive tools; closes over what `prepare` resolved so the prompt can name the resource. */
  confirm?: () => Promise<boolean>;
}

interface ToolCommandDef<A, Schema extends z.ZodObject, Result> {
  /** The tool this command is a front end for. */
  tool: Tool<Schema, Result>;
  command: string;
  aliases?: readonly string[];
  /** Defaults to the tool's description. */
  describe?: string;
  examples?: ReadonlyArray<readonly [string, string]>;
  builder?: (yargs: Argv) => Argv<A>;
  /** Turn CLI arguments into one invocation. Prompts, pickers, manifest lookups, and confirmations all belong here. */
  prepare: (
    args: A & GlobalArgs,
    ctx: ToolContext,
  ) => Promise<Prepared<Schema> | typeof CANCELLED>;
  /** Spinner text while the tool runs. Tool progress messages replace it. */
  progress?: string;
  /** CLI-local follow-up such as manifest cleanup. Runs for every output format. */
  after?: (result: Result, args: A & GlobalArgs) => void | Promise<void>;
  /** Take over printing entirely, ahead of both json and `render`. Return true once it has printed. */
  emit?: (result: Result, args: A & GlobalArgs) => boolean;
  /** Reshape the result before it is printed as JSON, e.g. to mask a secret the tool returns in full. */
  json?: (result: Result, args: A & GlobalArgs) => unknown;
  /** Render for humans. `--output json` prints the tool result instead and skips this. */
  render: (result: Result, args: A & GlobalArgs) => void;
}

/**
 * Wrap a tool in a yargs command.
 *
 * The tool owns the API work and the result shape; the command owns the UX:
 * flags, prompts, confirmation, spinner, and rendering. `--output json` prints
 * the tool result verbatim, so a CLI run and any other host return the same
 * document for the same operation.
 *
 * @example
 * ```ts
 * export const registryListCommand = defineToolCommand({
 *   tool: registriesList,
 *   command: "list",
 *   aliases: ["ls"],
 *   prepare: async () => ({ input: {} }),
 *   render: (registries, { output }) => logger.log(formatTable(...)),
 * });
 * ```
 */
export function defineToolCommand<A, Schema extends z.ZodObject, Result>(
  def: ToolCommandDef<A, Schema, Result>,
): CommandModule {
  return defineCommand<A>({
    command: def.command,
    aliases: def.aliases,
    describe: def.describe ?? def.tool.description,
    examples: def.examples,
    builder: def.builder,

    handler: async (args) => {
      const config = resolveConfig(args.profile, args.apiKey, args.verbose);
      const spin = spinner(def.progress ?? "Working...");
      const ctx = toolContext(config, {
        verbose: args.verbose,
        // Only steer the spinner while it runs, so progress never overwrites a prompt shown during prepare().
        onProgress: (message) => {
          if (spin.isSpinning) spin.text = message;
        },
      });

      const prepared = await def.prepare(args, ctx);
      if (prepared === CANCELLED) {
        logger.log("Cancelled.");
        return;
      }

      if (def.tool.kind === "destructive" && !prepared.confirm) {
        throw new Error(
          `Tool "${def.tool.name}" is destructive, so ${def.command} must return a confirm() from prepare().`,
        );
      }

      if (prepared.confirm && !(await prepared.confirm())) {
        logger.log("Cancelled.");
        return;
      }

      spin.start();
      let result: Result;
      try {
        result = await def.tool.invoke(ctx, prepared.input);
      } finally {
        spin.stop();
      }

      await def.after?.(result, args);

      if (def.emit?.(result, args)) return;

      if (args.output === "json") {
        const payload = def.json ? def.json(result, args) : result;
        logger.log(JSON.stringify(payload, null, 2));
        return;
      }

      def.render(result, args);
    },
  });
}
