import type { components } from "@bunny.net/api/generated/compute.d.ts";
import { existsSync } from "fs";
import { resolve, basename } from "path";
import prompts from "prompts";
import { defineCommand } from "../../core/define-command.ts";
import { resolveConfig } from "../../config/index.ts";
import { createComputeClient } from "@bunny.net/api";
import { confirm, spinner } from "../../core/ui.ts";
import { logger } from "../../core/logger.ts";
import { UserError } from "../../core/errors.ts";
import { saveManifestAt } from "../../core/manifest.ts";
import { SCRIPT_MANIFEST, TEMPLATES, type Template } from "./constants.ts";
import { clientOptions } from "../../core/client-options.ts";

type EdgeScript = components["schemas"]["EdgeScriptModel"];
type EdgeScriptTypes = components["schemas"]["EdgeScriptTypes"];

const COMMAND = "init";
const DESCRIPTION = "Create a new Edge Script project.";

const ARG_NAME = "name";
const ARG_NAME_DESCRIPTION = "Project directory name";
const ARG_TYPE = "type";
const ARG_TYPE_DESCRIPTION = "Script type";
const ARG_TEMPLATE = "template";
const ARG_TEMPLATE_DESCRIPTION = "Template name";
const ARG_DEPLOY = "deploy";
const ARG_DEPLOY_DESCRIPTION = "Deploy after creation";
const ARG_SKIP_GIT = "skip-git";
const ARG_SKIP_GIT_DESCRIPTION = "Skip git initialization";
const ARG_SKIP_INSTALL = "skip-install";
const ARG_SKIP_INSTALL_DESCRIPTION = "Skip dependency installation";

interface InitArgs {
  [ARG_NAME]?: string;
  [ARG_TYPE]?: string;
  [ARG_TEMPLATE]?: string;
  [ARG_DEPLOY]?: boolean;
  [ARG_SKIP_GIT]?: boolean;
  [ARG_SKIP_INSTALL]?: boolean;
}

/**
 * Create a new Edge Script project from a template.
 *
 * Walks through an interactive wizard to select a script type
 * (standalone or middleware), clone a starter template, install
 * dependencies, and optionally deploy the script to bunny.net.
 *
 * @example
 * ```bash
 * # Interactive wizard
 * bunny scripts init
 *
 * # Non-interactive with all options
 * bunny scripts init --name my-script --type standalone --template Empty --deploy
 *
 * # Skip git and dependency installation
 * bunny scripts init --name my-script --skip-git --skip-install
 * ```
 */
export const scriptsInitCommand = defineCommand<InitArgs>({
  command: COMMAND,
  describe: DESCRIPTION,

  builder: (yargs) =>
    yargs
      .option(ARG_NAME, {
        type: "string",
        describe: ARG_NAME_DESCRIPTION,
      })
      .option(ARG_TYPE, {
        type: "string",
        choices: ["standalone", "middleware"],
        describe: ARG_TYPE_DESCRIPTION,
      })
      .option(ARG_TEMPLATE, {
        type: "string",
        describe: ARG_TEMPLATE_DESCRIPTION,
      })
      .option(ARG_DEPLOY, {
        type: "boolean",
        describe: ARG_DEPLOY_DESCRIPTION,
      })
      .option(ARG_SKIP_GIT, {
        type: "boolean",
        describe: ARG_SKIP_GIT_DESCRIPTION,
      })
      .option(ARG_SKIP_INSTALL, {
        type: "boolean",
        describe: ARG_SKIP_INSTALL_DESCRIPTION,
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;

    // Step 1: Directory name
    let dirName = args[ARG_NAME];
    if (!dirName) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Project directory name:",
        initial: "my-edge-script",
      });
      dirName = value;
    }
    if (!dirName) throw new UserError("Directory name is required.");

    const dirPath = resolve(dirName);
    if (existsSync(dirPath)) {
      throw new UserError(`Directory "${dirName}" already exists.`);
    }

    // Step 2: Script type
    let scriptType: EdgeScriptTypes | undefined;
    if (args[ARG_TYPE]) {
      scriptType = args[ARG_TYPE] === "standalone" ? 1 : 2;
    } else {
      const { value } = await prompts({
        type: "select",
        name: "value",
        message: "Script type:",
        choices: [
          { title: "Standalone — handles requests independently", value: 1 },
          {
            title: "Middleware — processes requests before/after origin",
            value: 2,
          },
        ],
      });
      scriptType = value;
    }
    if (!scriptType) throw new UserError("Script type is required.");

    // Step 3: Template
    const filtered = TEMPLATES.filter((t) => t.scriptType === scriptType);
    let selected: Template | undefined;

    if (args[ARG_TEMPLATE]) {
      selected = filtered.find(
        (t) => t.name.toLowerCase() === args[ARG_TEMPLATE]!.toLowerCase(),
      );
      if (!selected) {
        throw new UserError(
          `Template "${args[ARG_TEMPLATE]}" not found.`,
          `Available templates: ${filtered.map((t) => t.name).join(", ")}`,
        );
      }
    } else {
      const { value } = await prompts({
        type: "select",
        name: "value",
        message: "Select a template:",
        choices: filtered.map((t) => ({
          title: `${t.name} — ${t.description}`,
          value: t,
        })),
      });
      selected = value;
    }
    if (!selected) throw new UserError("Template selection is required.");

    // Step 4: Clone template
    const spin = spinner(`Cloning template "${selected.name}"...`);
    spin.start();

    const clone = Bun.spawn(
      ["git", "clone", "--depth", "1", selected.repo, dirPath],
      { stdout: "ignore", stderr: "pipe" },
    );
    const cloneExit = await clone.exited;

    if (cloneExit !== 0) {
      spin.stop();
      const stderr = await new Response(clone.stderr).text();
      throw new UserError(
        "Could not clone template.",
        stderr.trim() || "Make sure git is installed.",
      );
    }

    // Remove .git so user starts fresh
    const gitDir = `${dirPath}/.git`;
    if (existsSync(gitDir)) {
      const rm = Bun.spawn(["rm", "-rf", gitDir], {
        stdout: "ignore",
        stderr: "ignore",
      });
      await rm.exited;
    }

    spin.stop();
    logger.success(`Created project from "${selected.name}" template.`);

    // Step 5: Install dependencies
    if (
      existsSync(`${dirPath}/package.json`) &&
      args[ARG_SKIP_INSTALL] !== true
    ) {
      const shouldInstall = await confirm("Install dependencies?");
      if (shouldInstall) {
        const installSpin = spinner("Installing dependencies...");
        installSpin.start();

        const install = Bun.spawn(["bun", "install"], {
          cwd: dirPath,
          stdout: "ignore",
          stderr: "pipe",
        });
        const installExit = await install.exited;
        installSpin.stop();

        if (installExit === 0) {
          logger.success("Dependencies installed.");
        } else {
          logger.warn(
            "Failed to install dependencies. Run `bun install` manually.",
          );
        }
      }
    }

    // Step 6: Save script type to manifest
    saveManifestAt(dirPath, SCRIPT_MANIFEST, { scriptType });

    // Step 7: Git init
    if (args[ARG_SKIP_GIT] !== true) {
      const shouldGit = await confirm("Initialize git repository?");
      if (shouldGit) {
        const gitInit = Bun.spawn(["git", "init"], {
          cwd: dirPath,
          stdout: "ignore",
          stderr: "ignore",
        });
        await gitInit.exited;

        // Ensure .bunny/ is in .gitignore
        const gitignorePath = `${dirPath}/.gitignore`;
        const existing = existsSync(gitignorePath)
          ? await Bun.file(gitignorePath).text()
          : "";

        if (!existing.includes(".bunny")) {
          await Bun.write(
            gitignorePath,
            existing +
              (existing.endsWith("\n") || existing === "" ? "" : "\n") +
              ".bunny/\n",
          );
        }

        logger.success("Initialized git repository.");
      }
    }

    // Step 8: Deploy (create script on bunny.net + link)
    let deployResult:
      | (Pick<EdgeScript, "Id" | "Name"> & { hostname?: string })
      | undefined;

    const shouldDeploy =
      args[ARG_DEPLOY] !== undefined
        ? args[ARG_DEPLOY]
        : await confirm("Deploy script now?");

    if (shouldDeploy) {
      const config = resolveConfig(profile, apiKey);
      const client = createComputeClient(clientOptions(config, verbose));
      const scriptName = basename(dirPath);

      const createSpin = spinner(`Creating script "${scriptName}"...`);
      createSpin.start();

      const { data: script } = await client.POST("/compute/script", {
        body: {
          Name: scriptName,
          ScriptType: scriptType,
          CreateLinkedPullZone: true,
        },
      });

      createSpin.stop();

      if (!script) {
        logger.warn("Could not create script on bunny.net.");
      } else {
        logger.success(`Created script "${script.Name}" (ID: ${script.Id}).`);

        // Update manifest with remote ID
        saveManifestAt(dirPath, SCRIPT_MANIFEST, {
          id: script.Id,
          name: script.Name ?? undefined,
          scriptType,
        });

        deployResult = {
          Id: script.Id,
          Name: script.Name,
          hostname: script.LinkedPullZones?.[0]?.DefaultHostname ?? undefined,
        };

        if (deployResult.hostname) {
          logger.dim(`  URL: ${deployResult.hostname}`);
        }
      }
    }

    logger.log();
    logger.success(`Project created in ${dirName}`);
    logger.dim(`  cd ${dirName}`);

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            directory: dirName,
            scriptType,
            template: selected.name,
            ...(deployResult && {
              script: {
                id: deployResult.Id,
                name: deployResult.Name,
                hostname: deployResult.hostname,
              },
            }),
          },
          null,
          2,
        ),
      );
    }
  },
});
