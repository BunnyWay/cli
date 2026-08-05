import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import prompts from "prompts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { normalizeHostname } from "../../core/hostnames/index.ts";
import { logger } from "../../core/logger.ts";
import { saveManifestAt } from "../../core/manifest.ts";
import {
  detectFromLockfile,
  pickPackageManager,
} from "../../core/package-manager.ts";
import { confirm, spinner } from "../../core/ui.ts";
import { promptOpenInBrowser } from "./api.ts";
import {
  type EdgeScriptTypes,
  parseScriptType,
  SCRIPT_MANIFEST,
  SCRIPT_TYPE_MIDDLEWARE,
  SCRIPT_TYPE_STANDALONE,
  TEMPLATES,
  type Template,
} from "./constants.ts";
import { createScript, setupCustomDomain } from "./create.ts";

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
const ARG_GITHUB_ACTIONS = "github-actions";
const ARG_GITHUB_ACTIONS_DESCRIPTION =
  "Keep the template's GitHub Actions workflow for CI deploys (use --no-github-actions to remove it)";
const ARG_SKIP_GIT = "skip-git";
const ARG_SKIP_GIT_DESCRIPTION = "Skip git initialization";
const ARG_SKIP_INSTALL = "skip-install";
const ARG_SKIP_INSTALL_DESCRIPTION = "Skip dependency installation";

interface InitArgs {
  [ARG_NAME]?: string;
  [ARG_TYPE]?: string;
  [ARG_TEMPLATE]?: string;
  [ARG_TEMPLATE_REPO]?: string;
  [ARG_DEPLOY]?: boolean;
  [ARG_GITHUB_ACTIONS]?: boolean;
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
 * # Non-interactive, no GitHub Actions
 * bunny scripts init --name my-script --type standalone --template Empty --no-github-actions --deploy
 *
 * # Non-interactive, keep the GitHub Actions workflow
 * bunny scripts init --name my-script --type standalone --template Empty --github-actions --deploy
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
      "$0 scripts init --name my-script --type standalone --template Empty --no-github-actions",
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
      .option(ARG_GITHUB_ACTIONS, {
        type: "boolean",
        describe: ARG_GITHUB_ACTIONS_DESCRIPTION,
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
    let scriptType: EdgeScriptTypes | undefined = parseScriptType(
      args[ARG_TYPE],
    );
    if (scriptType === undefined && args[ARG_TEMPLATE_REPO]) {
      // Custom template repo implies the user knows what they're doing — default to standalone
      scriptType = SCRIPT_TYPE_STANDALONE;
    } else if (scriptType === undefined) {
      const { value } = await prompts({
        type: "select",
        name: "value",
        message: "Script type:",
        choices: [
          {
            title: "Standalone — handles requests independently",
            value: SCRIPT_TYPE_STANDALONE,
          },
          {
            title: "Middleware — processes requests before/after origin",
            value: SCRIPT_TYPE_MIDDLEWARE,
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

    // Step 4: GitHub Actions opt-in. Whether to keep the template's
    // `.github/` workflow. CLI deploys work either way — this only
    // controls whether the CI workflow file ships with the project.
    let enableGithubActions: boolean;
    if (args[ARG_GITHUB_ACTIONS] !== undefined) {
      enableGithubActions = args[ARG_GITHUB_ACTIONS];
    } else if (interactive) {
      enableGithubActions = await confirm(
        "Enable continuous integration with GitHub Actions?",
      );
    } else {
      enableGithubActions = false;
    }

    // Step 5: Clone template
    const spin = spinner(`Cloning template "${selected.name}"...`);
    spin.start();

    const clone = Bun.spawn(
      ["git", "clone", "--depth", "1", "--", selected.repo, dirPath],
      {
        stdout: "ignore",
        stderr: "pipe",
      },
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

    // Drop `.changeset/` unconditionally — bunny scripts don't use it.
    // Drop `.github/` only when CI is disabled; otherwise the workflow stays.
    const dirsToRemove = [".changeset"];
    if (!enableGithubActions) dirsToRemove.push(".github");
    for (const dir of dirsToRemove) {
      const dirToRemove = `${dirPath}/${dir}`;
      if (existsSync(dirToRemove)) {
        const rm = Bun.spawn(["rm", "-rf", dirToRemove], {
          stdout: "ignore",
          stderr: "ignore",
        });
        await rm.exited;
      }
    }

    spin.stop();
    logger.success(`Created project from "${selected.name}" template.`);

    // Step 6: Install dependencies
    if (
      existsSync(`${dirPath}/package.json`) &&
      args[ARG_SKIP_INSTALL] !== true
    ) {
      // Always confirm before installing for custom template repos —
      // a malicious template's lifecycle scripts (preinstall, postinstall)
      // would otherwise run silently in non-interactive mode.
      const shouldInstall =
        interactive || args[ARG_TEMPLATE_REPO]
          ? await confirm("Install dependencies?")
          : true;
      if (shouldInstall) {
        const pm = await pickPackageManager(dirPath);
        if (!pm) {
          logger.warn(
            "No package manager found on PATH. Install bun, npm, pnpm, or yarn, then install dependencies in the new project.",
          );
        } else {
          const lockfilePm = detectFromLockfile(dirPath);
          if (lockfilePm && lockfilePm !== pm) {
            logger.warn(
              `Template ships a ${lockfilePm} lockfile but ${lockfilePm} isn't installed — using ${pm}. Lockfile will be regenerated.`,
            );
          }
          const installSpin = spinner(`Installing dependencies (${pm})...`);
          installSpin.start();

          let installExit = 1;
          try {
            const install = Bun.spawn([pm, "install"], {
              cwd: dirPath,
              stdout: "ignore",
              stderr: "pipe",
            });
            installExit = await install.exited;
          } catch {
            // Binary vanished between detection and spawn (warn below).
          }
          installSpin.stop();

          if (installExit === 0) {
            logger.success("Dependencies installed.");
          } else {
            logger.warn(
              `Failed to install dependencies. Run \`${pm} install\` manually.`,
            );
          }
        }
      }
    }

    // Step 7: Save script type to manifest
    saveManifestAt(dirPath, SCRIPT_MANIFEST, { scriptType });

    // Step 8: Git init. CI implies git, so skip the prompt when CI is on.
    // `--skip-git` still wins as an explicit opt-out.
    if (args[ARG_SKIP_GIT] !== true) {
      const shouldGit =
        enableGithubActions ||
        (interactive ? await confirm("Initialize git repository?") : true);
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

    const shouldDeploy =
      args[ARG_DEPLOY] !== undefined
        ? args[ARG_DEPLOY]
        : interactive
          ? await confirm("Create script on bunny.net?")
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

        const isInteractive = output !== "json" && process.stdout.isTTY;

        // Offer a custom domain; on SSL success the browser prompt opens it instead.
        let openTarget = deployResult.hostname;
        if (created.pullZoneId != null && isInteractive) {
          const { value } = await prompts({
            type: "text",
            name: "value",
            message: "Custom domain (leave blank to skip):",
          });
          const domain = normalizeHostname(value ?? "");
          if (domain) {
            // A domain failure mustn't trip the script-creation catch — the script already exists.
            try {
              // The user is still outside the project directory, so hints must carry --id.
              const sslIssued = await setupCustomDomain({
                profile,
                apiKey,
                verbose,
                pullZoneId: created.pullZoneId,
                domain,
                scriptId: created.id,
                linked: false,
                interactive: true,
              });
              if (sslIssued) openTarget = domain;
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : "";
              logger.warn(
                message
                  ? `Couldn't finish setting up ${domain}: ${message}`
                  : `Couldn't finish setting up ${domain}.`,
              );
              logger.dim(
                `  Retry later: bunny scripts domains add ${domain} --id ${created.id} --wait`,
              );
            }
            logger.log();
          }
        }

        if (openTarget && isInteractive) {
          await promptOpenInBrowser(openTarget);
        } else if (deployResult.hostname) {
          logger.dim(`  URL: ${deployResult.hostname}`);
        }

        if (enableGithubActions) {
          logger.log();
          logger.info(
            "Before pushing to GitHub, add this secret to your repo:",
          );
          logger.dim(`  SCRIPT_ID = ${created.id}`);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "";
        logger.warn(
          message
            ? `Could not create script on bunny.net: ${message}`
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
            githubActions: enableGithubActions,
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
