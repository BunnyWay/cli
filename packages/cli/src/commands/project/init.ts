import { existsSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import prompts from "prompts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import {
  augmentProjectConfig,
  loadProjectConfig,
  PROJECT_CONFIG_FILENAME,
  projectConfigTemplate,
  upsertBinding,
} from "../../core/project-config.ts";
import { confirm } from "../../core/ui.ts";
import {
  type AccountResource,
  fetchAccountResources,
  uniqueBinding,
} from "./import-account.ts";

const COMMAND = "init [name]";
const DESCRIPTION = "Create or upgrade a bunny.jsonc in the current directory.";

const ARG_NAME = "name";
const ARG_FROM_ACCOUNT = "from-account";

interface InitArgs {
  [ARG_NAME]?: string;
  [ARG_FROM_ACCOUNT]?: boolean;
}

interface ImportedBinding {
  kind: AccountResource["kind"];
  binding: string;
  id: string | number;
}

/** Record the chosen resources, suffixing bindings that would collide within their kind. */
function recordResources(selected: AccountResource[]): ImportedBinding[] {
  const config = loadProjectConfig();
  const taken = {
    databases: new Set(Object.keys(config.databases ?? {})),
    scripts: new Set(Object.keys(config.scripts ?? {})),
  };

  const imported: ImportedBinding[] = [];
  for (const resource of selected) {
    const binding = uniqueBinding(taken[resource.kind], resource.binding);
    taken[resource.kind].add(binding);
    upsertBinding(resource.kind, binding, resource.entry);
    imported.push({ kind: resource.kind, binding, id: resource.entry.id });
  }
  return imported;
}

/**
 * Scaffold the project resource map. If a `bunny.jsonc` already exists (e.g.
 * an apps-only one), it's upgraded in place — project keys are added via
 * surgical edits and the app block is left untouched.
 */
export const projectInitCommand = defineCommand<InitArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 project init", "Use the current directory name"],
    ["$0 project init acme-storefront", "Explicit project name"],
    [
      "$0 project init --from-account",
      "Map the account's databases and scripts (all of them when non-interactive)",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional(ARG_NAME, {
        type: "string",
        describe: "Project name (defaults to current directory name)",
      })
      .option(ARG_FROM_ACCOUNT, {
        type: "boolean",
        describe:
          "Map existing account resources (skips the prompt). Use --no-from-account to skip without prompting.",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const isInteractive = output !== "json" && process.stdout.isTTY;
    const name = args[ARG_NAME] ?? basename(resolve(process.cwd()));
    const path = join(process.cwd(), PROJECT_CONFIG_FILENAME);

    let upgraded = false;
    if (existsSync(path)) {
      const existing = loadProjectConfig(path);
      if (existing.databases !== undefined || existing.scripts !== undefined) {
        throw new UserError(
          `${PROJECT_CONFIG_FILENAME} already has a resource map.`,
          "Run `bunny project show` to inspect it, or `bunny project add` to map more resources.",
        );
      }
      augmentProjectConfig(name, path);
      upgraded = true;
    } else {
      writeFileSync(path, projectConfigTemplate(name));
    }

    // Decide whether to import account resources: flag → prompt → skip.
    const fromAccountArg = args[ARG_FROM_ACCOUNT];
    let shouldImport: boolean;
    if (fromAccountArg !== undefined) {
      shouldImport = fromAccountArg;
    } else if (isInteractive) {
      shouldImport = await confirm(
        "Map existing databases and scripts from your account?",
        { force: false },
      );
    } else {
      shouldImport = false;
    }

    let imported: ImportedBinding[] = [];
    if (shouldImport) {
      let resources: AccountResource[] = [];
      try {
        resources = await fetchAccountResources({ profile, apiKey, verbose });
      } catch (err) {
        // Only fatal when explicitly requested; the scaffold itself succeeded.
        if (fromAccountArg) throw err;
        logger.warn(
          `Could not fetch account resources: ${err instanceof Error ? err.message : err}`,
        );
      }

      if (shouldImport && resources.length === 0) {
        logger.dim("  No databases or Edge Scripts found on this account.");
      } else if (isInteractive) {
        const { selected } = await prompts({
          type: "multiselect",
          name: "selected",
          message: "Select resources to map:",
          choices: resources.map((r) => ({
            title: r.label,
            value: r,
            selected: true,
          })),
          hint: "Space to toggle, Enter to confirm",
        });
        imported = recordResources(selected ?? []);
      } else {
        imported = recordResources(resources);
      }
    }

    if (output === "json") {
      logger.log(JSON.stringify({ path, name, upgraded, imported }, null, 2));
      return;
    }

    if (upgraded) {
      logger.success(
        `Upgraded ${PROJECT_CONFIG_FILENAME} with a resource map for "${name}".`,
      );
    } else {
      logger.success(`Created ${PROJECT_CONFIG_FILENAME} for "${name}".`);
    }

    for (const entry of imported) {
      logger.log(`  Mapped ${entry.kind}.${entry.binding} → ${entry.id}`);
    }

    logger.log();
    logger.dim("  Map more resources:");
    logger.dim("    bunny project add database <binding>");
    logger.dim("    bunny project add script <binding>");
    logger.dim(
      "  Or create new ones — `bunny db create` and `bunny scripts create` will offer to record them.",
    );
  },
});
