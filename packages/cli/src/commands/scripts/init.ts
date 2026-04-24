import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { components } from "@bunny.net/api/generated/compute.d.ts";
import prompts from "prompts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { saveManifestAt } from "../../core/manifest.ts";
import { confirm, openBrowser, spinner } from "../../core/ui.ts";
import { SCRIPT_MANIFEST, TEMPLATES, type Template } from "./constants.ts";
import { createScript } from "./create.ts";

type EdgeScriptTypes = components["schemas"]["EdgeScriptTypes"];

const COMMAND = "init";
const DESCRIPTION = "Create a new Edge Script project.";

const ARG_NAME = "name";
const ARG_NAME_DESCRIPTION = "Project directory name";
const ARG_TYPE = "type";
const ARG_TYPE_DESCRIPTION = "Script type";
const ARG_TEMPLATE = "template";
const ARG_TEMPLATE_DESCRIPTION = "Template name";
const ARG_TEMPLATE_REPO = "template-repo";
const ARG_TEMPLATE_REPO_ALIAS = "repo";
const ARG_TEMPLATE_REPO_DESCRIPTION =
  "Git repository URL or GitHub owner/repo shorthand to use as template";
const ARG_DEPLOY = "deploy";
const ARG_DEPLOY_DESCRIPTION = "Deploy after creation";
const ARG_DEPLOY_METHOD = "deploy-method";
const ARG_DEPLOY_METHOD_DESCRIPTION =
  "Deployment method: github (GitHub Actions) or cli (manual)";
const ARG_SKIP_GIT = "skip-git";
const ARG_SKIP_GIT_DESCRIPTION = "Skip git initialization";
const ARG_SKIP_INSTALL = "skip-install";
const ARG_SKIP_INSTALL_DESCRIPTION = "Skip dependency installation";

type DeployMethod = "github" | "cli";

interface InitArgs {
  [ARG_NAME]?: string;
  [ARG_TYPE]?: string;
  [ARG_TEMPLATE]?: string;
  [ARG_TEMPLATE_REPO]?: string;
  [ARG_DEPLOY]?: boolean;
  [ARG_DEPLOY_METHOD]?: string;
  [ARG_SKIP_GIT]?: boolean;
  [ARG_SKIP_INSTALL]?: boolean;
}

const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+$/;

function resolveTemplateRepo(input: string): string {
  return GITHUB_SHORTHAND.test(input) ? `https://github.com/${input}` : input;
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
 * # Non-interactive with CLI deployment
 * bunny scripts init --name my-script --type standalone --template Empty --deploy-method cli --deploy
 *
 * # Non-interactive with GitHub Actions
 * bunny scripts init --name my-script --type standalone --template Empty --deploy-method github --deploy
 *
 * # Skip dependency installation
 * bunny scripts init --name my-script --skip-install
 *
 * # Use a custom template repo (full URL)
 * bunny scripts init --name my-script --type standalone --template-repo https://github.com/user/my-template
 *
 * # Use a custom template repo (GitHub owner/repo shorthand)
 * bunny scripts init --repo user/my-template
 * ```
 */
export const scriptsInitCommand = defineCommand<InitArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 scripts init", "Interactive wizard"],
    [
      "$0 scripts init --name my-script --type standalone --template Empty --deploy-method cli",
      "Non-interactive",
    ],
  ],

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
      .option(ARG_TEMPLATE_REPO, {
        type: "string",
        alias: ARG_TEMPLATE_REPO_ALIAS,
        describe: ARG_TEMPLATE_REPO_DESCRIPTION,
      })
      .option(ARG_DEPLOY, {
        type: "boolean",
        describe: ARG_DEPLOY_DESCRIPTION,
      })
      .option(ARG_DEPLOY_METHOD, {
        type: "string",
        choices: ["github", "cli"],
        describe: ARG_DEPLOY_METHOD_DESCRIPTION,
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

    // Detect non-interactive mode: name was provided via flag
    const interactive = !args[ARG_NAME];

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
    } else if (args[ARG_TEMPLATE_REPO]) {
      // Custom template repo implies the user knows what they're doing — default to standalone
      scriptType = 1;
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
    const finalScriptType: EdgeScriptTypes = scriptType;

    // Step 3: Template
    const filtered = TEMPLATES.filter((t) => t.scriptType === finalScriptType);
    let selected: Template | undefined;

    if (args[ARG_TEMPLATE_REPO]) {
      if (args[ARG_TEMPLATE]) {
        throw new UserError("Cannot use both --template and --template-repo.");
      }
      selected = {
        name: "Custom",
        description: "Custom template repository",
        repo: resolveTemplateRepo(args[ARG_TEMPLATE_REPO]),
        scriptType: finalScriptType,
      };
    } else if (args[ARG_TEMPLATE]) {
      selected = filtered.find(
        (t) => t.name.toLowerCase() === args[ARG_TEMPLATE]?.toLowerCase(),
      );
      if (!selected) {
        throw new UserError(
          `Template "${args[ARG_TEMPLATE]}" not found.`,
          `Available templates: ${filtered.map((t) => t.name).join(", ")}`,
        );
      }
    } else if (interactive) {
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
    } else {
      selected = filtered.find((t) => t.name.toLowerCase() === "empty");
    }
    if (!selected) throw new UserError("Template selection is required.");

    // Step 4: Deployment method
    let deployMethod: DeployMethod | undefined;

    if (args[ARG_DEPLOY_METHOD]) {
      deployMethod = args[ARG_DEPLOY_METHOD] as DeployMethod;
    } else if (interactive) {
      const { value } = await prompts({
        type: "select",
        name: "value",
        message: "How will you deploy?",
        choices: [
          {
            title: "GitHub Actions — deploy on push to main",
            value: "github",
          },
          {
            title: "CLI — deploy manually with `bunny scripts deploy`",
            value: "cli",
          },
        ],
      });
      deployMethod = value;
    } else {
      deployMethod = "cli";
    }
    if (!deployMethod) throw new UserError("Deployment method is required.");

    // Step 5: Clone template
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

    // Remove GitHub-specific files for CLI deployments
    if (deployMethod === "cli") {
      for (const dir of [".github", ".changeset"]) {
        const dirToRemove = `${dirPath}/${dir}`;
        if (existsSync(dirToRemove)) {
          const rm = Bun.spawn(["rm", "-rf", dirToRemove], {
            stdout: "ignore",
            stderr: "ignore",
          });
          await rm.exited;
        }
      }
    }

    spin.stop();
    logger.success(`Created project from "${selected.name}" template.`);

    // Step 6: Install dependencies
    if (
      existsSync(`${dirPath}/package.json`) &&
      args[ARG_SKIP_INSTALL] !== true
    ) {
      const shouldInstall = interactive
        ? await confirm("Install dependencies?")
        : true;
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

    // Step 7: Save script type to manifest
    saveManifestAt(dirPath, SCRIPT_MANIFEST, { scriptType });

    // Step 8: Git init
    if (deployMethod === "github") {
      // GitHub Actions implies git — auto-init without prompting
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
    } else if (args[ARG_SKIP_GIT] !== true) {
      const shouldGit = interactive
        ? await confirm("Initialize git repository?")
        : true;
      if (shouldGit) {
        const gitInit = Bun.spawn(["git", "init"], {
          cwd: dirPath,
          stdout: "ignore",
          stderr: "ignore",
        });
        await gitInit.exited;

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

    // Step 9: Create script on bunny.net + link
    let deployResult:
      | { id: number; name: string; hostname?: string }
      | undefined;

    const deployPrompt =
      deployMethod === "github"
        ? "Create script on bunny.net?"
        : "Deploy script now?";

    const shouldDeploy =
      args[ARG_DEPLOY] !== undefined
        ? args[ARG_DEPLOY]
        : interactive
          ? await confirm(deployPrompt)
          : false;

    if (shouldDeploy) {
      try {
        const created = await createScript({
          profile,
          apiKey,
          verbose,
          name: basename(dirPath),
          scriptType: finalScriptType,
          createLinkedPullZone: true,
        });

        logger.success(`Created script "${created.name}" (ID: ${created.id}).`);

        // Update manifest with remote ID
        saveManifestAt(dirPath, SCRIPT_MANIFEST, {
          id: created.id,
          name: created.name,
          scriptType,
        });

        deployResult = {
          id: created.id,
          name: created.name,
          hostname: created.hostname,
        };

        if (
          deployResult.hostname &&
          output !== "json" &&
          process.stdout.isTTY
        ) {
          const shouldOpen = await confirm("Open script in browser?");
          if (shouldOpen) {
            const url = deployResult.hostname.startsWith("http")
              ? deployResult.hostname
              : `https://${deployResult.hostname}`;
            logger.dim(`  Opening ${url}`);
            openBrowser(url);
          } else {
            logger.dim(
              "  Make changes locally, then run `bunny scripts deploy <file>` to publish.",
            );
          }
        } else if (deployResult.hostname) {
          logger.dim(`  URL: ${deployResult.hostname}`);
        }

        if (deployMethod === "github") {
          logger.log();
          logger.info(
            "Before pushing to GitHub, add this secret to your repo:",
          );
          logger.dim(`  SCRIPT_ID = ${created.id}`);
        }
      } catch (err: any) {
        logger.warn(
          err?.message
            ? `Could not create script on bunny.net: ${err.message}`
            : "Could not create script on bunny.net.",
        );
        logger.dim(
          "  Run `bunny scripts create` from the project directory to retry.",
        );
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
            deployMethod,
            ...(deployResult && {
              script: {
                id: deployResult.id,
                name: deployResult.name,
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
