import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { collectEnv } from "../../core/env.ts";
import { errorMessage, UserError } from "../../core/errors.ts";
import { formatBytes } from "../../core/format.ts";
import { normalizeHostname } from "../../core/hostnames/index.ts";
import { logger } from "../../core/logger.ts";
import { confirm, isInteractive, prompts, withSpinner } from "../../core/ui.ts";
import {
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
  deployIdError,
  findDeploy,
  markCurrent,
  type RemoteSiteState,
} from "./constants.ts";
import { type DeployIdentity, resolveDeployIdentity } from "./deploy-id.ts";
import { setupSiteDomain } from "./domains/index.ts";
import {
  type SiteSelectorArgs,
  selectSite,
  siteLinkOption,
  siteOptionBuilder,
} from "./interactive.ts";
import { createLinkedSite, promptSiteName } from "./provision.ts";
import {
  collectFiles,
  hashFiles,
  pruneDeployOrphans,
  uploadDeploy,
} from "./uploader.ts";

interface DeployArgs extends SiteSelectorArgs {
  dir?: string;
  build?: string;
  env?: string[];
  "env-file"?: string;
  force?: boolean;
  "deploy-id"?: string;
}

export interface DeployTarget {
  /** The ID this deploy will live under in storage. */
  deployId: string;
  /** True when these exact bytes are already uploaded under `deployId`. */
  skipUpload: boolean;
  /**
   * An existing deploy that blocks this one.
   *
   * `content`: the same ID already holds different bytes; --force replaces it.
   * `case`: an ID differing only in case exists. Not forceable, because two
   * deploys whose paths differ only by case are indistinguishable to anything
   * that folds case, and the loser's files would back the winner's rollback.
   * `live`/`rollback`: the ID holds different bytes AND is the production
   * deploy or the rollback target. Not forceable, because replacing it means
   * rewriting the very prefix the router serves (or would roll back to)
   * file-by-file, and a failure mid-replace strands it on a mix of both.
   */
  conflict?: {
    record: DeployRecord;
    reason: "content" | "case" | "live" | "rollback";
  };
}

/**
 * Decide which ID this deploy lands under and whether the upload can be skipped.
 *
 * Change detection keys on content, not the display ID, so a rebuilt `dist/` at
 * the same git sha is never wrongly skipped. An explicit ID is an assertion
 * about identity, so it never aliases onto an earlier deploy that merely shares
 * content: a catalog release keeps its own ID even when the bytes are identical
 * to the last one. Reusing an ID for different bytes rewrites what a rollback
 * to it would serve, so that is reported as a conflict rather than done quietly.
 */
export function resolveDeployTarget(opts: {
  deploys: DeployRecord[];
  identity: DeployIdentity;
  customId?: string;
  force: boolean;
  /** The production deploy and the rollback target; their content is never replaced in place. */
  current?: string;
  previous?: string;
}): DeployTarget {
  const { deploys, identity, customId, force, current, previous } = opts;

  const alreadyUploaded = force
    ? undefined
    : deploys.find(
        (d) =>
          // A pending record marks an interrupted (or in-flight) write; its prefix can't be trusted to hold these bytes, so re-upload instead of skipping.
          !d.pending &&
          (customId
            ? d.id === customId && d.contentHash === identity.contentHash
            : d.contentHash === identity.contentHash),
      );
  // A skipped deploy reuses the already-uploaded deploy's id; that's where its files live.
  const deployId = alreadyUploaded?.id ?? identity.id;
  const skipUpload = alreadyUploaded !== undefined;

  if (customId && !skipUpload) {
    const { caseVariant } = findDeploy(deploys, customId);
    if (caseVariant) {
      return {
        deployId,
        skipUpload,
        conflict: { record: caseVariant, reason: "case" },
      };
    }
  }

  if (!skipUpload) {
    const existing = deploys.find((d) => d.id === deployId);
    if (existing && existing.contentHash !== identity.contentHash) {
      // Replacing the deploy production serves (or would roll back to) rewrites its prefix while the router reads it, so it is refused outright — before the forceable content conflict, which would otherwise send the caller down a --force dead end. A same-bytes re-upload stays fine: every write is byte-identical.
      if (deployId === current || deployId === previous) {
        return {
          deployId,
          skipUpload,
          conflict: {
            record: existing,
            reason: deployId === current ? "live" : "rollback",
          },
        };
      }
      if (customId && !force) {
        return {
          deployId,
          skipUpload,
          conflict: { record: existing, reason: "content" },
        };
      }
    }
  }
  return { deployId, skipUpload };
}

const DOMAIN_HINT =
  "  Add a custom production domain: bunny sites domains add <domain>";

const DEPLOY_ID_HINT =
  "IDs become storage paths, so they take letters, digits, and -, _ or . (e.g. 20260827-1433-r42).";

// A site's live URL: the custom domain when it has one, else its b-cdn.net host. Always https (b-cdn.net hosts carry bunny's certificate).
export function productionUrl(
  state: RemoteSiteState,
  systemHost?: string,
): string | undefined {
  const host = state.domain ?? systemHost;
  return host ? `https://${host}` : undefined;
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

// Deploy a directory: hash, skip if unchanged, upload to `deploys/{id}/`, record state, then publish it as the live site. Deploys are immutable under their own id, so `sites deployments publish` rolls back to any of them without re-uploading. `--build` runs the build first with `--env`/`--env-file` overrides.
export const sitesDeployCommand = defineCommand<DeployArgs>({
  command: "deploy [dir]",
  describe: "Deploy a directory to a site.",
  examples: [
    ["$0 sites deploy ./dist", "Deploy a directory and publish it live"],
    ["$0 sites deploy --build", "Run the configured build, then deploy"],
    [
      '$0 sites deploy ./dist --build "npm run build"',
      "Explicit build command",
    ],
    ["$0 sites deploy ./dist --site my-site", "Target a specific site"],
    [
      "$0 sites deploy ./catalog --deploy-id 20260827-1433-r42",
      "Identify the deploy with your own release ID",
    ],
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
        .option("force", {
          type: "boolean",
          default: false,
          describe:
            "Deploy even when the content is unchanged, or replace an existing --deploy-id's content",
        })
        .option("deploy-id", {
          type: "string",
          describe:
            "Identify this deploy yourself (e.g. a release or catalog ID) instead of using the git sha or content hash; used exactly as given",
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

    // The site's first-ever deploy is the one moment we offer a custom domain; declining self-limits, since the list is never empty again.
    const firstDeploy = state.deploys.length === 0;

    let etag = site.etag;

    // Republish an outdated router before deploying, so this deploy is served by the current source (state.routerVersion persists with this deploy's writes, including no-op runs, so it doesn't republish every time). A failure isn't fatal: the old router still resolves CURRENT_DEPLOY.
    let routerUpgraded = false;
    try {
      routerUpgraded = await ensureRouterCurrent({ computeClient, state });
      if (routerUpgraded && output !== "json") {
        logger.info("Republished the site's router.");
      }
    } catch (err) {
      logger.warn(`Couldn't update the site's router: ${errorMessage(err)}`);
      logger.dim("  Retry with `bunny sites upgrade-router`.");
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
        if (await confirm(prompt, { initial: true, optional: true })) {
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

    const customId = args["deploy-id"]?.trim();
    if (customId) {
      const problem = deployIdError(customId);
      if (problem) {
        throw new UserError(
          `Deploy ID "${customId}" ${problem}.`,
          DEPLOY_ID_HINT,
        );
      }
    }

    const identity = await resolveDeployIdentity(dir, files, customId);
    const target = resolveDeployTarget({
      deploys: state.deploys,
      identity,
      customId,
      force: args.force ?? false,
      current: state.current,
      previous: state.previous,
    });

    if (
      target.conflict?.reason === "live" ||
      target.conflict?.reason === "rollback"
    ) {
      const role =
        target.conflict.reason === "live"
          ? "the live production deploy"
          : "the rollback target";
      throw new UserError(
        `Deploy ${target.deployId} is ${role} for ${state.name}, and this content differs from what it holds.`,
        "Replacing it in place would rewrite files while the router serves them. Deploy under a new --deploy-id, or publish another deploy first and re-run.",
      );
    }
    if (target.conflict?.reason === "case") {
      throw new UserError(
        `Deploy ${target.conflict.record.id} already exists for ${state.name}, differing from "${customId}" only in case.`,
        `Reuse that exact ID to redeploy it, or pick one that isn't a case variant.`,
      );
    }
    if (target.conflict?.reason === "content") {
      throw new UserError(
        `Deploy ${customId} already exists for ${state.name} with different content.`,
        "Rolling back to that ID would serve these new files instead of the originals. Pick another ID, or pass --force to replace it.",
      );
    }

    const { deployId, skipUpload } = target;
    const alreadyLive = state.current === deployId;
    // Re-uploading onto an existing ID (--force, or a rebuilt artifact under the same git sha)
    // leaves any file the new build dropped behind in the prefix, still reachable via the router.
    const replacing =
      !skipUpload && state.deploys.some((d) => d.id === deployId);

    // The production URL prefers the custom domain; only fetch the system host when there is none.
    const systemHost = state.domain
      ? undefined
      : await fetchSystemHostname(coreClient, state.pullZoneId);
    const production = productionUrl(state, systemHost);

    // Nothing to upload and it's already live: still persist a router upgrade so re-runs converge.
    if (skipUpload && alreadyLive) {
      if (routerUpgraded) {
        etag = await writeRemoteState(connection, state, etag);
      }
      if (output === "json") {
        logger.log(
          JSON.stringify(
            {
              site: state.name,
              id: deployId,
              unchanged: true,
              live: true,
              production: production ?? null,
            },
            null,
            2,
          ),
        );
        return;
      }
      logger.info(
        `No changes: deploy ${deployId} is already live. Use --force to redeploy.`,
      );
      if (production) logger.log(`  ${production}`);
      // The common repeat path after declining the first-deploy domain offer still gets the hint.
      if (!state.domain) logger.dim(DOMAIN_HINT);
      return;
    }

    if (!skipUpload) {
      // The deploy record. A re-deployed ID keeps its slot but gets fresh metadata; the purge on promote drops the old bytes from cache.
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

      // Claim the ID in state before touching any object, and finalize only once every file landed: an interrupted or raced write leaves a record that says the prefix can't be trusted, never one vouching for bytes that aren't all there. The claim write also surfaces a concurrent deploy of the same ID (via `claimedId`) before this one starts scribbling over its files.
      state.deploys = [
        { ...record, pending: true },
        ...state.deploys.filter((d) => d.id !== deployId),
      ];
      etag = await writeRemoteState(connection, state, etag, {
        claimedId: deployId,
      });

      try {
        await withSpinner(`Uploading ${files.length} files...`, (spin) =>
          uploadDeploy(connection, deployId, files, {
            onFileUploaded: (done, total) => {
              spin.text = `Uploading ${done}/${total} files (${formatBytes(totalBytes)} total)...`;
            },
          }),
        );

        if (replacing) {
          const orphans = await withSpinner("Removing replaced files...", () =>
            pruneDeployOrphans(connection, deployId, files),
          );
          if (orphans.length > 0 && output !== "json") {
            logger.dim(
              `Removed ${orphans.length} file(s) the new build no longer includes.`,
            );
          }
        }
      } catch (err) {
        logger.warn(
          `Deploy ${deployId} is marked incomplete; re-run the deploy to finish it.`,
        );
        throw err;
      }

      state.deploys = [
        record,
        ...state.deploys.filter((d) => d.id !== deployId),
      ];
      etag = await writeRemoteState(connection, state, etag, {
        claimedId: deployId,
      });
    }

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
        claimedId: deployId,
      });
    });

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            site: state.name,
            id: deployId,
            source: identity.source,
            files: files.length,
            bytes: totalBytes,
            unchanged: skipUpload,
            live: true,
            production: production ?? null,
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
    if (production) logger.info(`Production: ${production}`);

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
