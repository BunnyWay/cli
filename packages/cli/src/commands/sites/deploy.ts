import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { collectEnv } from "../../core/env.ts";
import { errorMessage, UserError } from "../../core/errors.ts";
import { formatBytes } from "../../core/format.ts";
import { normalizeHostname } from "../../core/hostnames/index.ts";
import { logger } from "../../core/logger.ts";
import { confirm, isInteractive, withSpinner } from "../../core/ui.ts";
import {
  ensurePreviewZone,
  ensureRouterCurrent,
  fetchSystemHostname,
  promoteDeploy,
  writeRemoteState,
} from "./api.ts";
import {
  type RequestedBuild,
  resolveAutoBuild,
  resolveRequestedBuild,
  runBuildCommand,
} from "./build.ts";
import { loadSiteConfig } from "./config.ts";
import {
  type DeployRecord,
  markCurrent,
  type RemoteSiteState,
} from "./constants.ts";
import { resolveDeployIdentity } from "./deploy-id.ts";
import { setupSiteDomain } from "./domains/index.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  siteLinkOption,
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

const DOMAIN_HINT =
  "  Add a custom production domain: bunny sites domains add <domain>";

// Production and preview URLs for a deploy: production is the custom domain (else the site's b-cdn.net host), the preview is the deploy's own preview zone. Both are https-only (b-cdn.net hosts carry bunny's certificate).
export function deployUrls(
  state: RemoteSiteState,
  record: Pick<DeployRecord, "previewHost"> | undefined,
  systemHost?: string,
): { production?: string; preview?: string } {
  const productionHost = state.domain ?? systemHost;
  return {
    production: productionHost ? `https://${productionHost}` : undefined,
    preview: record?.previewHost ? `https://${record.previewHost}` : undefined,
  };
}

// A CLI path arg is cwd-relative; `sites.dir` and the detected output dir are relative to the bunny.jsonc root, where the build runs.
export function resolveDeployDir(
  argDir: string | undefined,
  configDir: string | undefined,
  autoDir: string | undefined,
  root: string,
): string {
  if (argDir !== undefined) return resolve(argDir);
  return resolve(root, configDir ?? autoDir ?? ".");
}

// Deploy a directory: hash, skip if unchanged, upload to `deploys/{id}/`, record state, then serve it. Every deploy gets its own preview pull zone (an immutable `sites-dpl-{id}-*.b-cdn.net` URL, HTTPS out of the box); `--production` publishes it as the live site, and the interactive first deploy offers to. `--build` runs the build first with `--env`/`--env-file` overrides.
export const sitesDeployCommand = defineCommand<DeployArgs>({
  command: "deploy [dir]",
  describe: "Deploy a directory to a site.",
  examples: [
    [
      "$0 sites deploy ./dist",
      "Deploy to an immutable preview URL (the first deploy offers to publish)",
    ],
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
    siteLinkOption(
      siteOptionBuilder(
        yargs.positional("dir", {
          type: "string",
          describe:
            "Directory to deploy (defaults to `sites.dir` in bunny.jsonc, then the detected framework's output dir when building, then the current directory)",
        }),
      )
        .option("build", {
          type: "string",
          describe:
            "Run a build first. Pass a command, or use the bare flag to run `sites.build` from bunny.jsonc (else the detected framework's build)",
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
          describe:
            "Publish the deploy as the live site (default: an immutable preview URL; a site's interactive first deploy offers to publish)",
        })
        .option("force", {
          type: "boolean",
          default: false,
          describe: "Deploy even when the content is unchanged",
        }),
    ),

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

    let requestedBuild: RequestedBuild | undefined;
    if (args.build !== undefined) {
      requestedBuild = await resolveRequestedBuild(
        args.build,
        siteConfig?.config.build,
        root,
      );
    }

    const config = resolveConfig(profile, apiKey, verbose);
    const options = clientOptions(config, verbose);
    const coreClient = createCoreClient(options);
    const computeClient = createComputeClient(options);

    // No `force` here: deploy's --force only redeploys unchanged content, so the picker stays.
    const { site, offerLink } = await selectSite(coreClient, {
      site: args.site,
      link: args.link,
      output,
      offerCreate: async () => {
        const name = await promptSiteName(undefined, true);
        return createLinkedSite({ coreClient, computeClient, name });
      },
    });
    const { state, connection } = site;

    // Publishing is always explicit (--production, or the interactive first-deploy offer below); an implicit publish would let a CI preview run go live on a fresh site.
    let publish = args.production === true;
    // The site's first-ever deploy is the one moment we offer a custom domain; declining self-limits, since the list is never empty again.
    const firstDeploy = state.deploys.length === 0;

    let etag = site.etag;

    // Preview zones route by hostname in the router, so an outdated router would serve production content on preview URLs; republish it first (state.routerVersion persists with this deploy's writes, including no-op runs, so it doesn't republish every time).
    let routerReady = true;
    let routerUpgraded = false;
    try {
      routerUpgraded = await ensureRouterCurrent({ computeClient, state });
      if (routerUpgraded && output !== "json") {
        logger.info("Republished the site's router (new preview routing).");
      }
    } catch (err) {
      routerReady = false;
      logger.warn(`Couldn't update the site's router: ${errorMessage(err)}`);
      logger.dim(
        "  This deploy gets no preview URL; retry with `bunny sites upgrade-router`.",
      );
    }

    let autoDir: string | undefined;
    if (requestedBuild) {
      if (requestedBuild.label)
        logger.info(`Detected ${requestedBuild.label}.`);
      // No dir given: target the detected framework's output dir, not the repo root the build ran in.
      if (explicitDir === undefined) autoDir = requestedBuild.dir;
      const overrides = await collectEnv(args.env, args["env-file"]);
      await runBuildCommand(requestedBuild.command, root, overrides);
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

    const dir = resolveDeployDir(
      args.dir,
      siteConfig?.config.dir,
      autoDir,
      root,
    );
    if (autoDir && explicitDir === undefined) {
      logger.info(`Deploying detected output directory: ${autoDir}`);
    }
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      throw new UserError(`Directory not found: ${dir}`);
    }

    const files = await withSpinner("Hashing files...", () =>
      hashFiles(collectFiles(dir)),
    );
    if (files.length === 0) {
      throw new UserError(
        `Nothing to deploy; ${dir} has no files.`,
        "Dotfiles and node_modules are excluded.",
      );
    }
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

    const identity = await resolveDeployIdentity(dir, files);

    // The no-op check keys on content, not the display id, so a rebuilt `dist/` at the same git sha isn't wrongly skipped.
    const alreadyUploaded = args.force
      ? undefined
      : state.deploys.find((d) => d.contentHash === identity.contentHash);
    const skipUpload = alreadyUploaded !== undefined;
    // A skipped deploy reuses the already-uploaded deploy's id; that's where its files live.
    const deployId = alreadyUploaded?.id ?? identity.id;
    const alreadyLive = state.current === deployId;

    // A fresh site's interactive first deploy would otherwise land nowhere visible; offer the publish that used to be implicit.
    if (!publish && state.current === undefined && isInteractive(output)) {
      publish = await confirm(
        "This site has no production deploy yet. Publish this one to production?",
        { initial: true },
      );
    }

    // Give the deploy its preview zone; a failure (or an outdated router) skips it, and the next deploy of this id retries.
    const ensurePreview = async (record: DeployRecord): Promise<boolean> => {
      if (!routerReady || record.previewZoneId) return false;
      const zone = await withSpinner("Creating the preview URL...", () =>
        ensurePreviewZone({ coreClient, state, deployId: record.id }),
      );
      if (!zone) return false;
      record.previewZoneId = zone.id;
      record.previewHost = zone.host;
      return true;
    };

    // The production URL prefers the custom domain; only fetch the system host when there is none.
    const systemHost = state.domain
      ? undefined
      : await fetchSystemHostname(coreClient, state.pullZoneId);

    // Nothing to upload or promote: the deploy is already up (and live, if publishing); still backfill its preview zone (and persist a router upgrade) so re-runs converge.
    if (skipUpload && (alreadyLive || !publish)) {
      const previewChanged = await ensurePreview(alreadyUploaded);
      if (previewChanged || routerUpgraded) {
        etag = await writeRemoteState(connection, state, etag);
      }
      const urls = deployUrls(state, alreadyUploaded, systemHost);
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
      // The common repeat path after declining the first-deploy domain offer still gets the hint.
      if (!state.domain) logger.dim(DOMAIN_HINT);
      return;
    }

    let record = alreadyUploaded;
    if (!skipUpload) {
      await withSpinner(`Uploading ${files.length} files...`, (spin) =>
        uploadDeploy(connection, deployId, files, {
          onFileUploaded: (done, total) => {
            spin.text = `Uploading ${done}/${total} files (${formatBytes(totalBytes)} total)...`;
          },
        }),
      );

      // Record the deploy. A re-deployed ID keeps its slot (and its preview zone) but gets fresh metadata.
      const prior = state.deploys.find((d) => d.id === deployId);
      record = {
        id: deployId,
        createdAt: new Date().toISOString(),
        source: identity.source,
        gitSha: identity.gitSha,
        dirty: identity.dirty,
        contentHash: identity.contentHash,
        files: files.length,
        bytes: totalBytes,
        previewZoneId: prior?.previewZoneId,
        previewHost: prior?.previewHost,
      };
      state.deploys = [
        record,
        ...state.deploys.filter((d) => d.id !== deployId),
      ];
      // Re-uploaded content under an existing id: purge its preview zone so the preview serves the new bytes; best-effort.
      if (prior?.previewZoneId) {
        await coreClient
          .POST("/pullzone/{id}/purgeCache", {
            params: { path: { id: prior.previewZoneId } },
            body: {},
          })
          .catch(() => {});
      }
    }
    const previewChanged = record ? await ensurePreview(record) : false;
    // Persist the new record (and any preview/router updates); a pure promote of an unchanged deploy leaves persistence to the promote write below.
    if (!skipUpload || previewChanged) {
      etag = await writeRemoteState(connection, state, etag);
    }

    if (publish) {
      await withSpinner("Publishing to production...", async () => {
        await promoteDeploy({
          computeClient,
          coreClient,
          state,
          deployId,
        });
        markCurrent(state, deployId);
        etag = await writeRemoteState(connection, state, etag, {
          promotedTo: deployId,
        });
      });
    }

    const urls = deployUrls(state, record, systemHost);

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            site: state.name,
            id: deployId,
            source: identity.source,
            files: files.length,
            bytes: totalBytes,
            promoted: publish,
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
    if (publish) {
      if (urls.production) logger.info(`Production: ${urls.production}`);
      if (urls.preview) logger.log(`  Preview:    ${urls.preview}`);
    } else {
      if (urls.preview) {
        logger.info(`Preview: ${urls.preview}`);
      } else {
        logger.warn(
          "This deploy has no preview URL yet; re-run the deploy to retry.",
        );
      }
      logger.info(
        `Publish it with \`bunny sites deploy --production\` or \`bunny sites deployments publish ${deployId}\`.`,
      );
    }

    // Domainless sites: the first deploy offers a custom production domain, later ones just hint.
    if (!state.domain) {
      logger.log();
      let handled = false;
      if (firstDeploy && isInteractive(output)) {
        const { value } = await prompts({
          type: "text",
          name: "value",
          message:
            "Custom domain for this site's production URL (leave blank to skip):",
        });
        const domain = normalizeHostname(value ?? "") || undefined;
        if (domain) {
          handled = true;
          // The domain flow writes state, so it needs the etag from this deploy's writes, not the stale read.
          site.etag = etag;
          try {
            await setupSiteDomain({
              coreClient,
              site,
              domain,
              interactive: true,
              verbose,
            });
          } catch (err) {
            logger.warn(
              `Couldn't finish setting up ${domain}: ${errorMessage(err)}`,
            );
            logger.dim(
              `  Retry later: bunny sites domains add ${domain} ${state.name}`,
            );
          }
        }
      }
      if (!handled) logger.dim(DOMAIN_HINT);
    }

    await offerLink();
  },
});
