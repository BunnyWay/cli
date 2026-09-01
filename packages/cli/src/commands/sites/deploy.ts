import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { collectEnv } from "../../core/env.ts";
import { errorMessage, UserError } from "../../core/errors.ts";
import { formatBytes } from "../../core/format.ts";
import { normalizeHostname } from "../../core/hostnames/index.ts";
import { logger } from "../../core/logger.ts";
import {
  confirm,
  isInteractive,
  prompts,
  requireConfirmable,
  withSpinner,
} from "../../core/ui.ts";
import {
  deleteDeployFiles,
  fetchSystemHostname,
  promoteDeploy,
  readRemoteState,
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
import { deleteBlocker } from "./deployments/delete.ts";
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
   * `content`: the same ID already holds different bytes; the handler asks
   * before replacing them (--force answers yes).
   * `case`: an ID differing only in case exists. Never replaceable, because two
   * deploys whose paths differ only by case are indistinguishable to anything
   * that folds case, and the loser's files would back the winner's rollback.
   * `live`/`rollback`: the ID holds different bytes AND is the production
   * deploy or the rollback target. Never replaceable, because a replacement
   * empties and rewrites the very prefix being served (or rolled back to).
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
    : deploys.find((d) =>
        customId
          ? d.id === customId && d.contentHash === identity.contentHash
          : d.contentHash === identity.contentHash,
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
      // Replacing the deploy production serves (or would roll back to) rewrites the prefix the edge is pulling from, so it is refused outright, before the confirmable content conflict (which would otherwise send the caller down a dead end). A same-bytes re-upload stays fine: every write is byte-identical.
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
      if (customId) {
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
            "Deploy even when the content is unchanged, and replace an existing --deploy-id's content without asking",
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

    // No `force` here: deploy's --force only redeploys unchanged content, so the picker stays.
    const { site, offerLink } = await selectSite(coreClient, {
      site: args.site,
      link: args.link,
      output,
      offerCreate: async () => {
        const name = await promptSiteName(undefined, true);
        return createLinkedSite({ coreClient, name });
      },
    });
    const { state, connection } = site;

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
    // An explicitly supplied empty ID (e.g. --deploy-id "$UNSET_VAR" in CI) must error, not silently fall back to the derived ID.
    if (customId !== undefined) {
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
        "Replacing it in place would rewrite files while they are being served. Deploy under a new --deploy-id, or publish another deploy first and re-run.",
      );
    }
    if (target.conflict?.reason === "case") {
      throw new UserError(
        `Deploy ${target.conflict.record.id} already exists for ${state.name}, differing from "${customId}" only in case.`,
        `Reuse that exact ID to redeploy it, or pick one that isn't a case variant.`,
      );
    }
    if (target.conflict?.reason === "content") {
      // Rolling back to the ID would serve the new files instead of the originals, so replacing is opt-in.
      requireConfirmable(output, {
        force: args.force,
        message: `Deploy ${customId} already exists for ${state.name} with different content; replacing it needs a confirmation prompt.`,
        hint: "Pick another ID, or re-run with --force to replace it non-interactively.",
      });
      const proceed = await confirm(
        `Deploy ${customId} already exists for ${state.name} with different content. Replace it?`,
        { force: args.force },
      );
      if (!proceed) {
        logger.log("Cancelled.");
        return;
      }
    }

    const { deployId, skipUpload } = target;
    const alreadyLive = state.current === deployId;

    // The production URL prefers the custom domain; only fetch the system host when there is none.
    const systemHost = state.domain
      ? undefined
      : await fetchSystemHostname(coreClient, state.pullZoneId);
    const production = productionUrl(state, systemHost);

    if (skipUpload && alreadyLive) {
      await withSpinner("Checking routing...", () =>
        promoteDeploy({ coreClient, state, deployId }),
      );
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
      // Unless these exact bytes are already recorded under the ID, the upload starts from an empty prefix: emptying first is what keeps a replaced deploy free of files the new content dropped, and also clears half-written leftovers from an interrupted earlier run.
      const existing = state.deploys.find((d) => d.id === deployId);
      if (existing && existing.contentHash !== identity.contentHash) {
        // Revalidate on fresh state right before anything destructive: the confirmation window is long enough for a concurrent publish to have made this ID live.
        const fresh = await readRemoteState(connection);
        if (!fresh) {
          throw new UserError(
            "Couldn't re-read the site state.",
            "Retry the deploy; nothing was replaced.",
          );
        }
        const blocker = deleteBlocker(fresh.state, deployId);
        if (blocker) {
          throw new UserError(
            `Deploy ${deployId} became ${blocker} for ${state.name} while this deploy was being prepared.`,
            "Publish another deploy first and re-run, or deploy under a new --deploy-id.",
          );
        }
        // Drop the record before deleting its files, so no record ever vouches for a prefix mid-rewrite (a concurrent publish re-reads state and refuses an ID without one), and a crashed replacement re-runs as a fresh upload.
        state.deploys = state.deploys.filter((d) => d.id !== deployId);
        etag = await writeRemoteState(connection, state, etag, {
          removedIds: [deployId],
        });
      }
      if (existing?.contentHash !== identity.contentHash) {
        await deleteDeployFiles(connection, deployId);
      }

      await withSpinner(`Uploading ${files.length} files...`, (spin) =>
        uploadDeploy(connection, deployId, files, {
          onFileUploaded: (done, total) => {
            spin.text = `Uploading ${done}/${total} files (${formatBytes(totalBytes)} total)...`;
          },
        }),
      );

      // Record the deploy. A re-deployed ID keeps its slot but gets fresh metadata; the purge on promote drops the old bytes from cache.
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
        ...state.deploys.filter((d) => d.id !== deployId),
      ];
      etag = await writeRemoteState(connection, state, etag);
    }

    await withSpinner("Publishing to production...", async () => {
      await promoteDeploy({ coreClient, state, deployId });
      markCurrent(state, deployId);
      etag = await writeRemoteState(connection, state, etag, {
        promotedTo: deployId,
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
