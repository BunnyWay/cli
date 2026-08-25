/**
 * `bunny lab undeploy astro`
 *
 * Take the app down, and delete the three resources it was made of. This is the
 * other half of the deploy: an experiment nobody can remove is not an experiment
 * anybody will start.
 *
 * The state file names what will go, so the prompt can list it. Without one,
 * `--name` finds the same resources the deploy created.
 */
import { resolve } from "node:path";
import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import {
  confirm,
  confirmTyped,
  requireConfirmable,
  withSpinner,
} from "../../../core/ui.ts";
import { requireValidAppName } from "./naming.ts";
import { resolveProject } from "./project.ts";
import { deleteResources, findResources } from "./resources.ts";
import {
  clearState,
  type LabState,
  loadState,
  STATE_VERSION,
} from "./state.ts";

interface UndeployArgs {
  dir?: string;
  name?: string;
  force: boolean;
  "keep-storage": boolean;
}

export const labUndeployAstroCommand = defineCommand<UndeployArgs>({
  command: "astro [dir]",
  describe: "Delete an Astro app and the resources it runs on.",
  examples: [
    ["$0 lab undeploy astro", "Take down the app this directory deploys to"],
    ["$0 lab undeploy astro --name my-app", "Name it, with no local state"],
    [
      "$0 lab undeploy astro --keep-storage",
      "Delete the script and pull zone, keep the files",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("dir", {
        type: "string",
        describe: "The project directory (default: the current one)",
      })
      .option("name", {
        type: "string",
        describe: "The app's name, when this directory has no state file",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        default: false,
        describe: "Skip the confirmation prompts",
      })
      .option("keep-storage", {
        type: "boolean",
        default: false,
        describe: "Keep the storage zone and every file in it",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey, force } = args;
    const json = output === "json";

    const config = resolveConfig(profile, apiKey, verbose);
    const options = clientOptions(config, verbose);
    const coreClient = createCoreClient(options);
    const computeClient = createComputeClient(options);

    const state = await resolveTarget({
      coreClient,
      computeClient,
      dir: args.dir,
      name: args.name,
      output,
    });

    const what = args["keep-storage"]
      ? "its pull zone and Edge Script"
      : "its pull zone, Edge Script, and ALL uploaded files";

    if (!json) {
      logger.log();
      logger.info(`"${state.name}" is made of:`);
      logger.dim(`  pull zone      ${state.pullZoneId}`);
      logger.dim(`  edge script    ${state.scriptId}`);
      logger.dim(
        `  storage zone   ${state.storageZone}${args["keep-storage"] ? " (kept)" : ""}`,
      );
      logger.log();
    }

    requireConfirmable(output, {
      force,
      message: `Deleting "${state.name}" needs a confirmation prompt.`,
      hint: "Re-run with --force to delete non-interactively.",
    });
    const confirmed =
      (await confirm(
        `Delete "${state.name}" (${what})? This cannot be undone.`,
        {
          force,
        },
      )) && (await confirmTyped(state.name, { force }));
    if (!confirmed) {
      logger.log("Cancelled.");
      return;
    }

    const results = await withSpinner("Deleting...", () =>
      deleteResources({
        coreClient,
        computeClient,
        state,
        keepStorage: args["keep-storage"],
      }),
    );

    const failures = results.filter((r) => !r.deleted);
    // The link goes only when everything it points at is gone. Keeping it is what
    // lets a failed run be repeated. `--name` names no directory, so there is no
    // link to clear.
    if (failures.length === 0 && state.root) clearState(state.root);

    if (json) {
      logger.log(
        JSON.stringify(
          { app: state.name, deleted: failures.length === 0, results },
          null,
          2,
        ),
      );
      if (failures.length > 0) process.exit(1);
      return;
    }

    for (const result of results) {
      if (result.deleted) {
        logger.success(`Deleted ${result.resource} ${result.id}.`);
      } else {
        logger.warn(
          `Couldn't delete ${result.resource} ${result.id}: ${result.error}`,
        );
      }
    }
    if (args["keep-storage"]) {
      logger.info(
        `Storage zone ${state.storageZone} was kept, with every file in it.`,
      );
    }
    if (failures.length > 0) {
      logger.dim("  Re-run the command to retry the failed deletions.");
      process.exit(1);
    }
  },
});

/**
 * What to delete: the state file, else the resources `--name` finds.
 *
 * A name and no state is the CI case, and the fresh-clone case. Looking the
 * resources up rather than trusting a remembered ID is also what makes the
 * command safe to re-run after a partial failure.
 */
async function resolveTarget(opts: {
  coreClient: ReturnType<typeof createCoreClient>;
  computeClient: ReturnType<typeof createComputeClient>;
  dir: string | undefined;
  name: string | undefined;
  output: string | undefined;
}): Promise<LabState & { root?: string }> {
  if (!opts.name) {
    // Reading the project is only for the state file beside it, so a directory
    // that is not an Astro project is not an error worth stopping for.
    const root =
      (await resolveProject(opts.dir, opts.output).catch(() => null)) ??
      resolve(opts.dir ?? process.cwd());
    const state = loadState(root);
    if (state) return { ...state, root };
    throw new UserError(
      "This directory has no .bunny/astro.json, so there is nothing to take down.",
      "Name the app instead: bunny lab undeploy astro --name my-app",
    );
  }

  const appName = requireValidAppName(opts.name);
  const found = await withSpinner(`Finding "${appName}"...`, () =>
    findResources({
      coreClient: opts.coreClient,
      computeClient: opts.computeClient,
      appName,
    }),
  );
  if (!found?.storageZone.Id) {
    throw new UserError(
      `Found no app called "${appName}".`,
      "Check the name with `bunny storage zones list`; this command's zones start with astro-.",
    );
  }
  return {
    version: STATE_VERSION,
    name: appName,
    storageZone: found.storageZone.Name ?? appName,
    storageZoneId: found.storageZone.Id,
    region: (found.storageZone.Region ?? "de").toLowerCase(),
    scriptId: found.scriptId,
    pullZoneId: found.pullZoneId,
    ...(found.hostname ? { hostname: found.hostname } : {}),
  };
}
