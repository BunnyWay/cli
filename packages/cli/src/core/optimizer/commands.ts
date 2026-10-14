import type { ToolContext } from "@bunny.net/tools";
import {
  type OptimizerStatus,
  pullZonesOptimizerGet,
  pullZonesOptimizerSet,
} from "@bunny.net/tools/pullzones";
import type { Argv, CommandModule } from "yargs";
import { defineNamespace } from "@/core/define-namespace.ts";
import { DONE, defineToolCommand } from "@/core/define-tool-command.ts";
import { formatKeyValue } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import type { GlobalArgs, OutputFormat } from "@/core/types.ts";
import { confirm, requireConfirmable, withSpinner } from "@/core/ui.ts";

/** How the resource that owns a pull zone wants Optimizer run; it travels with the target so every command that reaches the resource applies it. */
export interface OptimizerPolicy {
  /** Set CSS/JS minification on enable; omitted leaves the zone's setting alone. */
  minify?: boolean;
  /** Runs after Optimizer is turned on or off, e.g. to keep a config file in line. */
  onChanged?: (enabled: boolean, output: OutputFormat) => void;
  /** Extra line printed after a successful enable. */
  enableHint?: () => string | undefined;
}

/** The pull zone Optimizer acts on, named the way its owner is known. */
export interface OptimizerTarget {
  pullZone: number;
  name: string;
  /** What `name` names, e.g. "Site" or "Pull zone". */
  label: string;
  optimizer?: OptimizerPolicy;
}

export interface OptimizerMountOptions {
  /** Command breadcrumb used in examples and hints, e.g. "sites optimizer". */
  commandPath: string;
  describe: string;
  /** Trailing positional that names the target, e.g. `site` or `pull-zone`. */
  positional: { name: string; describe: string };
  /** Resolve the positional (or the linked directory) to a pull zone. */
  resolve: (
    ref: string | undefined,
    args: GlobalArgs,
    ctx: ToolContext,
  ) => Promise<OptimizerTarget>;
}

export function formatPrice(monthly: number): string {
  return `$${monthly.toFixed(2)}/month`;
}

export function renderOptimizerStatus(
  label: string,
  name: string,
  status: OptimizerStatus,
  output: OutputFormat,
): void {
  const onOff = (on: boolean) => (on ? "on" : "off");
  const cacheKey =
    status.cacheKeyParameters === null
      ? "all query parameters"
      : status.cacheKeyParameters.length === 0
        ? "query strings ignored"
        : status.cacheKeyParameters.join(", ");
  logger.log(
    formatKeyValue(
      [
        { key: label, value: name },
        { key: "Optimizer", value: onOff(status.enabled) },
        { key: "WebP", value: onOff(status.webp) },
        { key: "Dynamic images", value: onOff(status.dynamicImages) },
        {
          key: "Minify CSS/JS",
          value: `${onOff(status.minify.css)}/${onOff(status.minify.js)}`,
        },
        { key: "Cache key", value: cacheKey },
        { key: "Price", value: formatPrice(status.monthlyPrice) },
      ],
      output,
    ),
  );
}

/** The `optimizer` namespace (status, enable, disable), mounted wherever a pull zone can be resolved. */
export function createOptimizerCommands(
  opts: OptimizerMountOptions,
): CommandModule {
  const { commandPath, positional } = opts;
  const targets = new WeakMap<object, OptimizerTarget>();
  const ref = (args: object) =>
    (args as Record<string, unknown>)[positional.name] as string | undefined;
  const resolve = async (args: GlobalArgs, ctx: ToolContext) => {
    const target = await opts.resolve(ref(args), args, ctx);
    targets.set(args, target);
    return target;
  };
  const nameOf = (args: object, pullZone: number) =>
    targets.get(args)?.name ?? `pull zone ${pullZone}`;
  const withTarget = <A>(yargs: Argv<A>) =>
    yargs.positional(positional.name, {
      type: "string",
      describe: positional.describe,
    });

  const status = defineToolCommand({
    tool: pullZonesOptimizerGet,
    command: `status [${positional.name}]`,
    describe: "Show whether Bunny Optimizer is on.",
    examples: [
      [`$0 ${commandPath} status`, "Status for the linked directory"],
      [`$0 ${commandPath} status --output json`, "As JSON"],
    ],
    progress: "Fetching Optimizer status...",
    builder: withTarget,
    prepare: async (args, ctx) => {
      const target = await resolve(args, ctx);
      return { input: { pullZone: target.pullZone } };
    },
    render: (result, args) => {
      renderOptimizerStatus(
        targets.get(args)?.label ?? "Pull zone",
        nameOf(args, result.pullZone),
        result,
        args.output,
      );
      logger.log();
      if (!result.enabled) {
        logger.dim(
          `  Turn it on (${formatPrice(result.monthlyPrice)}): bunny ${commandPath} enable`,
        );
      } else if (!result.configured) {
        logger.dim(
          `  Some settings differ from what Optimizer needs; re-apply them: bunny ${commandPath} enable`,
        );
      }
    },
  });

  const enable = defineToolCommand({
    tool: pullZonesOptimizerSet,
    command: `enable [${positional.name}]`,
    describe:
      "Turn on Bunny Optimizer: images served as WebP and sized for each device.",
    examples: [
      [`$0 ${commandPath} enable`, "Turn it on for the linked directory"],
      [`$0 ${commandPath} enable --yes`, "Skip the price confirmation"],
    ],
    epilogue:
      "Optimizer is billed monthly per pull zone. Turning it on also adds the Dynamic Image API (?width=, ?quality=, ...) for srcset loaders, adds those parameters to the cache key (other parameters cache as before), and purges the cache.",
    progress: "Turning on Bunny Optimizer...",
    builder: (yargs) =>
      withTarget(yargs).option("force", {
        type: "boolean",
        alias: ["yes", "y"],
        default: false,
        describe: "Skip the price confirmation",
      }),
    prepare: async (args, ctx) => {
      const target = await resolve(args, ctx);
      const current = await withSpinner("Fetching Optimizer status...", () =>
        pullZonesOptimizerGet.invoke(ctx, { pullZone: target.pullZone }),
      );
      if (current.enabled && current.configured) {
        if (args.output === "json") {
          logger.log(
            JSON.stringify(
              { ...current, changed: false, purged: false },
              null,
              2,
            ),
          );
        } else {
          logger.info(`Bunny Optimizer is already on for ${target.name}.`);
        }
        target.optimizer?.onChanged?.(true, args.output);
        return DONE;
      }
      const input = {
        pullZone: target.pullZone,
        enabled: true,
        minify: target.optimizer?.minify,
      };
      // Already paying: re-applying the settings needs no consent.
      if (current.enabled) return { input };

      const price = formatPrice(current.monthlyPrice);
      requireConfirmable(args.output, {
        force: args.force,
        message: `Bunny Optimizer costs ${price} for ${target.name}; turning it on needs a confirmation prompt.`,
        hint: "Re-run with --yes to accept the price non-interactively.",
      });
      return {
        input,
        confirm: () =>
          confirm(
            `Turn on Bunny Optimizer for ${target.name}? It costs ${price}.`,
            { force: args.force, initial: true },
          ),
      };
    },
    after: (_, args) => {
      targets.get(args)?.optimizer?.onChanged?.(true, args.output);
    },
    render: (result, args) => {
      const name = nameOf(args, result.pullZone);
      logger.success(
        result.changed
          ? `Bunny Optimizer is on for ${name}${result.purged ? " (cache purged)" : ""}.`
          : `Bunny Optimizer is already on for ${name}.`,
      );
      logger.dim(
        "  Images are now served as WebP and sized for each device, with no code changes.",
      );
      const hint = targets.get(args)?.optimizer?.enableHint?.();
      if (hint) logger.dim(`  ${hint}`);
    },
  });

  const disable = defineToolCommand({
    tool: pullZonesOptimizerSet,
    command: `disable [${positional.name}]`,
    describe: "Turn off Bunny Optimizer and restore the cache settings.",
    examples: [
      [`$0 ${commandPath} disable`, "Turn it off for the linked directory"],
    ],
    progress: "Turning off Bunny Optimizer...",
    builder: withTarget,
    prepare: async (args, ctx) => {
      const target = await resolve(args, ctx);
      return { input: { pullZone: target.pullZone, enabled: false } };
    },
    after: (_, args) => {
      targets.get(args)?.optimizer?.onChanged?.(false, args.output);
    },
    render: (result, args) => {
      const name = nameOf(args, result.pullZone);
      logger.success(
        result.changed
          ? `Bunny Optimizer is off for ${name}${result.purged ? " (cache purged)" : ""}.`
          : `Bunny Optimizer is already off for ${name}.`,
      );
    },
  });

  return defineNamespace("optimizer", opts.describe, [status, enable, disable]);
}
