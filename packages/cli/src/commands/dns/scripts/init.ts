import { existsSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createComputeClient } from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { saveManifestAt } from "../../../core/manifest.ts";
import { pickPackageManager } from "../../../core/package-manager.ts";
import { confirm, isInteractive, spinner } from "../../../core/ui.ts";
import { createDnsScript } from "./api.ts";
import {
  DEFAULT_ENTRY,
  DNS_SCRIPT_MANIFEST,
  type DnsScriptExample,
  type DnsScriptManifest,
  EXAMPLES,
  SCRIPT_TYPE_DNS,
  TSCONFIG,
  TYPES_PACKAGE,
  TYPES_PACKAGE_VERSION,
} from "./constants.ts";

const COMMAND = "init [name]";
const DESCRIPTION = "Scaffold a new Scriptable DNS script project.";

const ARG_NAME = "name";
const ARG_NAME_DESCRIPTION = "Project directory name";
const ARG_EXAMPLE = "example";
const ARG_EXAMPLE_DESCRIPTION = `Starter example: ${EXAMPLES.map((e) => e.key).join(", ")}`;
const ARG_DEPLOY = "deploy";
const ARG_DEPLOY_DESCRIPTION =
  "Create the script on bunny.net after scaffolding";
const ARG_SKIP_INSTALL = "skip-install";
const ARG_SKIP_INSTALL_DESCRIPTION = "Skip installing editor type dependencies";

interface InitArgs {
  [ARG_NAME]?: string;
  [ARG_EXAMPLE]?: string;
  [ARG_DEPLOY]?: boolean;
  [ARG_SKIP_INSTALL]?: boolean;
}

function packageJson(name: string): string {
  return `${JSON.stringify(
    {
      name,
      private: true,
      type: "module",
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: {
        [TYPES_PACKAGE]: TYPES_PACKAGE_VERSION,
        typescript: "^5",
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * Scaffold a Scriptable DNS script project.
 *
 * Writes a `handleQuery` entry file from a chosen example, a tsconfig and
 * package.json wired to the ambient runtime types for editor autocomplete,
 * and a `.bunny/dns-script.json` manifest. Optionally creates the script on
 * bunny.net so it is ready for `bunny dns scripts deploy`.
 *
 * @example
 * ```bash
 * # Interactive wizard
 * bunny dns scripts init
 *
 * # Non-interactive: geo example, create on bunny.net
 * bunny dns scripts init geo-router --example geo --deploy
 * ```
 */
export const dnsScriptsInitCommand = defineCommand<InitArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 dns scripts init", "Interactive wizard"],
    [
      "$0 dns scripts init geo-router --example geo --deploy",
      "Scaffold the geo example and create the script",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional(ARG_NAME, {
        type: "string",
        describe: ARG_NAME_DESCRIPTION,
      })
      .option(ARG_EXAMPLE, {
        type: "string",
        choices: EXAMPLES.map((e) => e.key),
        describe: ARG_EXAMPLE_DESCRIPTION,
      })
      .option(ARG_DEPLOY, {
        type: "boolean",
        describe: ARG_DEPLOY_DESCRIPTION,
      })
      .option(ARG_SKIP_INSTALL, {
        type: "boolean",
        describe: ARG_SKIP_INSTALL_DESCRIPTION,
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const interactive = isInteractive(output);

    let dirName = args[ARG_NAME];
    if (!dirName && interactive) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Project directory name:",
        initial: "my-dns-script",
      });
      dirName = value;
    }
    if (!dirName) throw new UserError("Directory name is required.");

    const dirPath = resolve(dirName);
    if (existsSync(dirPath)) {
      throw new UserError(`Directory "${dirName}" already exists.`);
    }

    let example: DnsScriptExample | undefined = args[ARG_EXAMPLE]
      ? EXAMPLES.find((e) => e.key === args[ARG_EXAMPLE])
      : undefined;
    if (!example && interactive) {
      const { value } = await prompts({
        type: "select",
        name: "value",
        message: "What should this script do?",
        choices: EXAMPLES.map((e) => ({ title: e.title, value: e })),
      });
      example = value;
    }
    example ??= EXAMPLES[0];
    if (!example) throw new UserError("An example is required.");

    mkdirSync(dirPath, { recursive: true });
    await Bun.write(`${dirPath}/${DEFAULT_ENTRY}`, example.code);
    await Bun.write(`${dirPath}/tsconfig.json`, TSCONFIG);
    await Bun.write(`${dirPath}/package.json`, packageJson(basename(dirPath)));
    await Bun.write(`${dirPath}/.gitignore`, ".bunny/\nnode_modules/\n");
    saveManifestAt<DnsScriptManifest>(dirPath, DNS_SCRIPT_MANIFEST, {
      scriptType: SCRIPT_TYPE_DNS,
      entry: DEFAULT_ENTRY,
    });

    logger.success(`Scaffolded "${example.title}" in ${dirName}.`);

    if (args[ARG_SKIP_INSTALL] !== true) {
      const install = interactive
        ? await confirm("Install editor type dependencies?")
        : false;
      if (install) {
        const pm = await pickPackageManager(dirPath);
        if (!pm) {
          logger.warn(
            "No package manager found on PATH. Install bun, npm, pnpm, or yarn, then install dependencies in the new project.",
          );
        } else {
          const spin = spinner(`Installing dependencies (${pm})...`);
          spin.start();
          let code = 1;
          try {
            const proc = Bun.spawn([pm, "install"], {
              cwd: dirPath,
              stdout: "ignore",
              stderr: "ignore",
            });
            code = await proc.exited;
          } catch {
            // Binary vanished between detection and spawn; warn below.
          }
          spin.stop();
          if (code === 0) {
            logger.success("Dependencies installed.");
          } else {
            logger.warn(
              `Could not install dependencies. Run \`${pm} install\` later.`,
            );
          }
        }
      }
    }

    let created: { id: number; name: string } | undefined;
    const deployExplicit = args[ARG_DEPLOY] === true;
    const shouldDeploy =
      args[ARG_DEPLOY] !== undefined
        ? args[ARG_DEPLOY]
        : interactive
          ? await confirm("Create the DNS script on bunny.net?")
          : false;

    if (shouldDeploy) {
      try {
        const config = resolveConfig(profile, apiKey, verbose);
        const client = createComputeClient(clientOptions(config, verbose));
        const spin = spinner("Creating DNS script...");
        spin.start();
        try {
          created = await createDnsScript(client, basename(dirPath));
        } finally {
          spin.stop();
        }
        saveManifestAt<DnsScriptManifest>(dirPath, DNS_SCRIPT_MANIFEST, {
          id: created.id,
          name: created.name,
          scriptType: SCRIPT_TYPE_DNS,
          entry: DEFAULT_ENTRY,
        });
        logger.success(`Created DNS script "${created.name}" (${created.id}).`);
      } catch (err: unknown) {
        // An explicit --deploy is a hard requirement; only the interactive opt-in degrades to a warning.
        if (deployExplicit) throw err;
        const message = err instanceof Error ? err.message : "";
        logger.warn(
          message
            ? `Could not create the script: ${message}`
            : "Could not create the script.",
        );
        logger.dim(
          "  Run `bunny dns scripts create` from the project to retry.",
        );
      }
    }

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            directory: dirName,
            example: example.key,
            entry: DEFAULT_ENTRY,
            ...(created && { script: created }),
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.log();
    logger.dim(`  cd ${dirName}`);
    if (!created) logger.dim("  Create:   bunny dns scripts create");
    logger.dim("  Deploy:   bunny dns scripts deploy");
    logger.dim("  Attach:   bunny dns scripts attach");
  },
});
