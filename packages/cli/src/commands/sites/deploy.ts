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
  fetchSiteHostnames,
  persistReconciledDomain,
  promoteDeploy,
  reconcilePreviewDomain,
  type SiteContext,
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
  previewHostname,
  previewWildcard,
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
  "  Add a custom domain to unlock preview deploys: bunny sites domains add <domain>";

// Production and preview URLs for a deploy: previews are `dpl-{id}.preview.{domain}` hosts, so they only exist once a custom domain is attached.
export function deployUrls(
  site: SiteContext,
  deployId: string,
  zone: { systemHost?: string; previewSecure?: boolean },
): { production?: string; preview?: string } {
  const domain = site.state.domain;
  const productionHost = domain ?? zone.systemHost;
  // Until the wildcard's certificate issues, an https preview URL fails TLS outright, while http serves fine (ForceSSL is only set alongside the cert).
  const previewScheme = zone.previewSecure === false ? "http" : "https";
  return {
    production: productionHost ? `https://${productionHost}` : undefined,
    preview: domain
      ? `${previewScheme}://${previewHostname(deployId, domain)}`
      : undefined,
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

// Deploy a directory: hash, skip if unchanged, upload to `deploys/{id}/`, record state, publish. Without a custom domain every deploy goes live; with one the default is a preview and `--production` publishes. `--build` runs the build first with `--env`/`--env-file` overrides.
export const sitesDeployCommand = defineCommand<DeployArgs>({
  command: "deploy [dir]",
  describe: "Deploy a directory to a site.",
  examples: [
    [
      "$0 sites deploy ./dist",
      "Deploy the site (a preview when a custom domain is attached, else live)",
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
            "Publish the deploy as the live site (always on when the site has no custom domain; with one, the default is a preview)",
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

    // The pull zone's preview wildcard, not the best-effort recorded state, decides preview mode: a stale-missing domain must not publish a CI preview to production, and a stale-present one must not advertise preview URLs that can't serve.
    const zone = await fetchSiteHostnames(
      coreClient,
      state.pullZoneId,
      state.domain,
    );
    const staleDomain = state.domain;
    const drift = reconcilePreviewDomain(state, zone);
    if (drift === "detached" && staleDomain && output !== "json") {
      logger.warn(
        `${previewWildcard(staleDomain)} isn't on the pull zone, so previews can't serve; this deploy publishes directly.`,
      );
      logger.dim(
        `  Restore it with: bunny sites domains add ${staleDomain} ${state.name}`,
      );
    }
    if (drift === "switched" && staleDomain && output !== "json") {
      logger.warn(
        `${previewWildcard(staleDomain)} isn't on the pull zone; this site's domain is now ${state.domain}.`,
      );
      logger.dim(
        `  To switch back: bunny sites domains add ${staleDomain} ${state.name}`,
      );
    }
    // Persist before the deploy's own writes so an unchanged/no-op run still heals the state the read-only commands show.
    if (drift) await persistReconciledDomain(site);

    // No custom domain means no preview hosts, so every deploy publishes; with a domain, previews are the default and --production is the publish switch.
    const publish = args.production === true || !state.domain;
    // The site's first-ever deploy is the one moment we offer a custom domain; declining self-limits, since the list is never empty again.
    const firstDeploy = state.deploys.length === 0;

    let etag = site.etag;

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

    // The preview host serves http-only until the wildcard's certificate issues; say so wherever a preview URL prints.
    const previewTlsHint = () => {
      if (zone.previewSecure === false && state.domain) {
        logger.dim(
          `  Preview HTTPS pending; once DNS is live: bunny sites domains ssl "${previewWildcard(state.domain)}" ${state.name}`,
        );
      }
    };

    // Nothing to do: the deploy is already uploaded (and live, if publishing).
    if (skipUpload && (alreadyLive || !publish)) {
      const urls = deployUrls(site, deployId, zone);
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
      if (urls.preview) {
        logger.log(`  Preview: ${urls.preview}`);
        previewTlsHint();
      }
      // The common repeat path after declining the first-deploy domain offer still gets the hint.
      if (!state.domain) logger.dim(DOMAIN_HINT);
      return;
    }

    if (!skipUpload) {
      await withSpinner(`Uploading ${files.length} files...`, (spin) =>
        uploadDeploy(connection, deployId, files, {
          onFileUploaded: (done, total) => {
            spin.text = `Uploading ${done}/${total} files (${formatBytes(totalBytes)} total)...`;
          },
        }),
      );

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

    const urls = deployUrls(site, deployId, zone);

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
      previewTlsHint();
    } else {
      if (urls.preview) logger.info(`Preview: ${urls.preview}`);
      previewTlsHint();
      logger.info(
        `Publish it with \`bunny sites deploy --production\` or \`bunny sites deployments publish ${deployId}\`.`,
      );
    }

    // Domainless sites: the first deploy offers a custom domain (which unlocks preview deploys), later ones just hint.
    if (!state.domain) {
      logger.log();
      let handled = false;
      if (firstDeploy && isInteractive(output)) {
        const { value } = await prompts({
          type: "text",
          name: "value",
          message:
            "Custom domain for this site (unlocks preview deploys; leave blank to skip):",
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
            // state.domain stays unset when the preview wildcard didn't attach; deploys keep publishing (the wildcard failure already printed the retry hint).
            if (site.state.domain) {
              logger.dim(
                "  From now on `bunny sites deploy` creates a preview; publish with --production.",
              );
            }
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
