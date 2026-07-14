import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { formatBytes } from "../../core/format.ts";
import { logger } from "../../core/logger.ts";
import { confirm, isInteractive, spinner } from "../../core/ui.ts";
import {
  fetchSystemHostname,
  promoteDeploy,
  type SiteContext,
  writeRemoteState,
} from "./api.ts";
import {
  parseEnvAssignments,
  parseEnvFile,
  resolveAutoBuild,
  runBuildCommand,
} from "./build.ts";
import { loadSiteConfig } from "./config.ts";
import {
  type DeployRecord,
  deployPrefix,
  previewHostname,
} from "./constants.ts";
import { resolveDeployIdentity } from "./deploy-id.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  siteOptionBuilder,
} from "./interactive.ts";
import { createLinkedSite, promptSiteName } from "./provision.ts";
import { collectFiles, hashFiles, uploadDeploy } from "./uploader.ts";

interface DeployArgs extends SiteSelectorArgs {
  dir?: string;
  build?: string;
  env?: string[];
  "env-file"?: string;
  production?: boolean;
  force?: boolean;
}

/**
 * Production and preview URLs for a deploy, derived from the site's hosts.
 *
 * With a custom domain the preview is an isolated per-deploy subdomain
 * (`dpl-{id}.preview.{domain}`); otherwise it's the immutable `/deploys/{id}/`
 * path on the system host, which the router's HTMLRewriter makes render
 * correctly even for root-absolute asset URLs.
 */
function deployUrls(
  site: SiteContext,
  deployId: string,
  systemHost: string | undefined,
): { production?: string; preview?: string } {
  const domain = site.state.domain;
  const productionHost = domain ?? systemHost;
  return {
    production: productionHost ? `https://${productionHost}` : undefined,
    preview: domain
      ? `https://${previewHostname(deployId, domain)}`
      : productionHost
        ? `https://${productionHost}/${deployPrefix(deployId)}/`
        : undefined,
  };
}

/**
 * Deploy a directory: hash → skip if unchanged → upload to `deploys/{id}/` →
 * record in remote state → serve at a preview URL. With `--production`, also
 * publish it (env var + cache purge) as the live site. With `--build`, runs
 * the build command first in the caller's environment plus `--env`/`--env-file`
 * overrides.
 */
export const sitesDeployCommand = defineCommand<DeployArgs>({
  command: "deploy [dir]",
  describe: "Deploy a directory to a site.",
  examples: [
    ["$0 sites deploy ./dist", "Deploy to a preview URL"],
    [
      "$0 sites deploy ./dist --production",
      "Deploy and publish as the live site",
    ],
    ["$0 sites deploy --build", "Run the configured build, then deploy"],
    [
      '$0 sites deploy ./dist --build "npm run build"',
      "Explicit build command",
    ],
    ["$0 sites deploy ./dist --site my-site", "Target a specific site"],
  ],

  builder: (yargs) =>
    siteOptionBuilder(
      yargs.positional("dir", {
        type: "string",
        describe:
          "Directory to deploy (defaults to `sites.dir` in bunny.jsonc, then the current directory)",
      }),
    )
      .option("build", {
        type: "string",
        describe:
          "Run a build first. Pass a command, or use the bare flag to run `sites.build` from bunny.jsonc",
      })
      .option("env", {
        type: "string",
        array: true,
        describe: "Build-time env override (KEY=VALUE, repeatable)",
      })
      .option("env-file", {
        type: "string",
        describe: "Read build-time env overrides from a dotenv-style file",
      })
      .option("production", {
        alias: "prod",
        type: "boolean",
        default: false,
        describe: "Publish the deploy as the live site (default: preview only)",
      })
      .option("force", {
        type: "boolean",
        default: false,
        describe: "Deploy even when the content is unchanged",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const siteConfig = loadSiteConfig();
    const root = siteConfig?.root ?? process.cwd();
    const explicitDir = args.dir ?? siteConfig?.config.dir;

    if (args.build === undefined && (args.env?.length || args["env-file"])) {
      throw new UserError(
        "--env/--env-file only apply to builds.",
        "Add --build to run the build with these variables.",
      );
    }

    const config = resolveConfig(profile, apiKey, verbose);
    const options = clientOptions(config, verbose);
    const coreClient = createCoreClient(options);
    const computeClient = createComputeClient(options);

    const { site, offerLink } = await selectSite(coreClient, {
      site: args.site,
      link: args.link,
      output,
      offerCreate: async () => {
        const name = await promptSiteName(undefined, true);
        return createLinkedSite({ coreClient, computeClient, name });
      },
    });
    const { state, connection, etag } = site;

    // Build before hashing so the deploy ID keys on the output (and a first build can create the dir).
    let autoDir: string | undefined;
    if (args.build !== undefined) {
      const command = args.build || siteConfig?.config.build;
      if (!command) {
        throw new UserError(
          "No build command configured.",
          'Pass one (`--build "npm run build"`) or set `sites.build` in bunny.jsonc.',
        );
      }
      const overrides = {
        ...(args["env-file"]
          ? parseEnvFile(await Bun.file(resolve(args["env-file"])).text())
          : {}),
        ...parseEnvAssignments(args.env),
      };
      await runBuildCommand(command, root, overrides);
    } else if (isInteractive(output)) {
      // No --build: offer to run the configured build, else a detected one.
      const configured = siteConfig?.config.build;
      const auto = configured
        ? { command: configured, label: "the configured build" }
        : await resolveAutoBuild(root);
      if (auto) {
        // Target the framework's output dir unless one was given (whether or not the build runs).
        if (explicitDir === undefined && "dir" in auto) autoDir = auto.dir;
        const prompt = configured
          ? `Run ${auto.label} (\`${auto.command}\`) before deploying?`
          : `Detected ${auto.label}. Run \`${auto.command}\` before deploying?`;
        if (await confirm(prompt, { initial: true })) {
          await runBuildCommand(auto.command, root, {});
        }
      }
    }

    const dir = resolve(explicitDir ?? autoDir ?? ".");
    if (autoDir && explicitDir === undefined) {
      logger.info(`Deploying detected output directory: ${autoDir}`);
    }
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      throw new UserError(`Directory not found: ${dir}`);
    }

    const hashSpin = spinner("Hashing files...");
    hashSpin.start();
    let files: Awaited<ReturnType<typeof hashFiles>>;
    try {
      files = await hashFiles(collectFiles(dir));
    } finally {
      hashSpin.stop();
    }
    if (files.length === 0) {
      throw new UserError(
        `Nothing to deploy — ${dir} has no files.`,
        "Dotfiles and node_modules are excluded.",
      );
    }
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

    const identity = await resolveDeployIdentity(dir, files);

    // The no-op check keys on content, not the display id: a rebuilt `dist/`
    // at the same git sha ships different bytes and must not be skipped.
    const existing = args.force
      ? undefined
      : state.deploys.find((d) => d.contentHash === identity.contentHash);
    const skipUpload = existing !== undefined;
    // A skipped deploy reuses the already-uploaded deploy's id — that's where its files live.
    const deployId = existing?.id ?? identity.id;
    const alreadyLive = state.current === deployId;

    // Nothing to do: the deploy is already uploaded (and live, if --production).
    if (skipUpload && (alreadyLive || !args.production)) {
      const urls = deployUrls(
        site,
        deployId,
        await fetchSystemHostname(coreClient, state.pullZoneId),
      );
      if (output === "json") {
        logger.log(
          JSON.stringify(
            {
              site: state.name,
              id: deployId,
              unchanged: true,
              live: alreadyLive,
              production: urls.production ?? null,
              preview: urls.preview ?? null,
            },
            null,
            2,
          ),
        );
        return;
      }
      if (alreadyLive) {
        logger.info(
          `No changes: deploy ${deployId} is already live. Use --force to redeploy.`,
        );
      } else {
        logger.info(
          `No changes: deploy ${deployId} is already uploaded. Publish it with \`bunny sites deploy --production\`.`,
        );
      }
      if (urls.preview) logger.log(`  Preview: ${urls.preview}`);
      return;
    }

    if (!skipUpload) {
      const uploadSpin = spinner(`Uploading ${files.length} files...`);
      uploadSpin.start();
      try {
        await uploadDeploy(connection, deployId, files, {
          onFileUploaded: (done, total) => {
            uploadSpin.text = `Uploading ${done}/${total} files (${formatBytes(totalBytes)} total)...`;
          },
        });
      } finally {
        uploadSpin.stop();
      }

      // Record the deploy. A re-deployed ID keeps its slot but gets fresh metadata.
      const record: DeployRecord = {
        id: deployId,
        createdAt: new Date().toISOString(),
        source: identity.source,
        gitSha: identity.gitSha,
        dirty: identity.dirty,
        contentHash: identity.contentHash,
        files: files.length,
        bytes: totalBytes,
      };
      state.deploys = [
        record,
        ...state.deploys.filter((d) => d.id !== record.id),
      ];
    }
    if (args.production) {
      if (state.current && state.current !== deployId) {
        state.previous = state.current;
      }
      state.current = deployId;
    }
    await writeRemoteState(connection, state, etag);

    if (args.production) {
      const promoteSpin = spinner("Publishing to production...");
      promoteSpin.start();
      try {
        await promoteDeploy({
          computeClient,
          coreClient,
          state,
          deployId,
        });
      } finally {
        promoteSpin.stop();
      }
    }

    const urls = deployUrls(
      site,
      deployId,
      await fetchSystemHostname(coreClient, state.pullZoneId),
    );

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            site: state.name,
            id: deployId,
            source: identity.source,
            files: files.length,
            bytes: totalBytes,
            promoted: args.production === true,
            production: urls.production ?? null,
            preview: urls.preview ?? null,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (skipUpload) {
      logger.success(`Deploy ${deployId} is now live.`);
    } else {
      logger.success(
        `Deployed ${deployId} (${files.length} files, ${formatBytes(totalBytes)}).`,
      );
    }
    if (args.production) {
      if (urls.production) logger.info(`Production: ${urls.production}`);
      if (urls.preview) logger.log(`  Preview:    ${urls.preview}`);
    } else {
      if (urls.preview) logger.info(`Preview: ${urls.preview}`);
      logger.info(
        `Publish it with \`bunny sites deploy --production\` or \`bunny sites deployments publish ${deployId}\`.`,
      );
    }

    await offerLink();
  },
});
