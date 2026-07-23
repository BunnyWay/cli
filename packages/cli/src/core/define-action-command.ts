import type { Action, ActionContext } from "@bunny.net/actions";
import type { Argv, CommandModule } from "yargs";
import type { z } from "zod";
import { resolveConfig } from "../config/index.ts";
import { actionContext } from "./action-context.ts";
import { defineCommand } from "./define-command.ts";
import { logger } from "./logger.ts";
import type { GlobalArgs } from "./types.ts";
import { spinner } from "./ui.ts";

/** Returned by {@link ActionCommandDef.prepare} to stop without running the action. */
export const CANCELLED = Symbol("cancelled");

/** The result of turning CLI arguments into a single action invocation. */
export interface Prepared<Schema extends z.ZodObject> {
  /** Validated by the action's schema before it runs. */
  input: z.input<Schema>;
  /**
   * Confirmation gate for this invocation. Required for destructive actions.
   * Closes over whatever `prepare` resolved, so the prompt can name the exact
   * resource and pass `--force` through.
   */
  confirm?: () => Promise<boolean>;
}

interface ActionCommandDef<A, Schema extends z.ZodObject, Result> {
  /** The action this command is a front end for. */
  action: Action<Schema, Result>;
  command: string;
  aliases?: readonly string[];
  /** Defaults to the action's description. */
  describe?: string;
  examples?: ReadonlyArray<readonly [string, string]>;
  builder?: (yargs: Argv) => Argv<A>;
  /**
   * Turn CLI arguments into one action invocation. Prompts, pickers, manifest
   * lookups, and confirmations all belong here; the action never asks anything.
   * Return {@link CANCELLED} to stop without running.
   */
  prepare: (
    args: A & GlobalArgs,
    ctx: ActionContext,
  ) => Promise<Prepared<Schema> | typeof CANCELLED>;
  /**
   * Declares that this destructive action needs no prompt, because running the
   * command is itself the intent (uploading a file, creating a resource).
   * `grep skipConfirm` lists every mutation the CLI performs unprompted.
   */
  skipConfirm?: true;
  /** Spinner text while the action runs. Action progress messages replace it. */
  progress?: string;
  /** CLI-local follow-up such as manifest cleanup. Runs for every output format. */
  after?: (result: Result, args: A & GlobalArgs) => void | Promise<void>;
  /**
   * Take over printing entirely, ahead of both json and {@link ActionCommandDef.render}.
   * Return true once it has printed. For alternate emitters like `--format rclone`.
   */
  emit?: (result: Result, args: A & GlobalArgs) => boolean;
  /**
   * Reshape the result before it is printed as JSON, e.g. to mask a secret the
   * action returns in full. Defaults to printing the result as-is.
   */
  json?: (result: Result, args: A & GlobalArgs) => unknown;
  /** Render for humans. `--output json` prints the action result instead and skips this. */
  render: (result: Result, args: A & GlobalArgs) => void;
}

/**
 * Wrap an action in a yargs command.
 *
 * The action owns the API work and the result shape; the command owns the UX -
 * flags, prompts, confirmation, spinner, and rendering. `--output json` prints
 * the action result verbatim, so a CLI run and an MCP tool call return the same
 * document for the same operation.
 *
 * @example
 * ```ts
 * export const storageZoneListCommand = defineActionCommand({
 *   action: storageZonesList,
 *   command: "list",
 *   aliases: ["ls"],
 *   prepare: async ({ search }) => ({ input: { search } }),
 *   render: (zones, { output }) => logger.log(formatTable(...)),
 * });
 * ```
 */
export function defineActionCommand<A, Schema extends z.ZodObject, Result>(
  def: ActionCommandDef<A, Schema, Result>,
): CommandModule {
  return defineCommand<A>({
    command: def.command,
    aliases: def.aliases,
    describe: def.describe ?? def.action.description,
    examples: def.examples,
    builder: def.builder,

    handler: async (args) => {
      const config = resolveConfig(args.profile, args.apiKey, args.verbose);
      const spin = spinner(def.progress ?? "Working...");
      const ctx = actionContext(config, {
        verbose: args.verbose,
        // Only steer the spinner while it is running, so an action's progress
        // messages can never overwrite a prompt shown during prepare().
        onProgress: (message) => {
          if (spin.isSpinning) spin.text = message;
        },
      });

      const prepared = await def.prepare(args, ctx);
      if (prepared === CANCELLED) {
        logger.log("Cancelled.");
        return;
      }

      if (def.action.destructive && !prepared.confirm && !def.skipConfirm) {
        throw new Error(
          `Action "${def.action.name}" is destructive, so ${def.command} must return a confirm() from prepare() or set skipConfirm.`,
        );
      }

      if (prepared.confirm && !(await prepared.confirm())) {
        logger.log("Cancelled.");
        return;
      }

      spin.start();
      let result: Result;
      try {
        result = await def.action.invoke(ctx, prepared.input);
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
