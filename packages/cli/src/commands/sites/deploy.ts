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
import { spinner } from "../../core/ui.ts";
import {
  promoteDeploy,
  readRemoteEnv,
  type SiteContext,
  writeRemoteState,
} from "./api.ts";
import {
  envHash,
  parseEnvAssignments,
  parseEnvFile,
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
import { collectFiles, hashFiles, uploadDeploy } from "./uploader.ts";

interface DeployArgs extends SiteSelectorArgs {
  dir?: string;
  build?: string;
  env?: string[];
  "env-file"?: string;
  promote?: boolean;
  force?: boolean;
}

/** Production and preview URLs for a deploy, derived from the site's hosts. */
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
 * record in remote state → promote (env var + cache purge) unless
 * `--no-promote`. With `--build`, runs the build command first with the
 * site's remote env merged with `--env`/`--env-file` overrides.
 */
export const sitesDeployCommand = defineCommand<DeployArgs>({
  command: "deploy [dir]",
  describe: "Deploy a directory to a site.",
  examples: [
    ["$0 sites deploy ./dist", "Deploy and promote to production"],
    ["$0 sites deploy ./dist --no-promote", "Upload without promoting"],
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
      .option("promote", {
        type: "boolean",
        default: true,
        describe:
          "Promote the deploy to production (default: true). Use --no-promote to only upload.",
      })
      .option("force", {
        type: "boolean",
        default: false,
        describe: "Deploy even when the content is unchanged",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const siteConfig = loadSiteConfig();

    const dir = resolve(args.dir ?? siteConfig?.config.dir ?? ".");
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      throw new UserError(`Directory not found: ${dir}`);
    }
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
    });
    const { state, connection, etag } = site;

    // Build first — the deploy ID must hash the build *output*.
    let buildEnvHash: string | undefined;
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
      const remoteEnv = await readRemoteEnv(connection);
      const mergedEnv = { ...remoteEnv, ...overrides };
      buildEnvHash = envHash(mergedEnv);
      await runBuildCommand(
        command,
        siteConfig?.root ?? process.cwd(),
        mergedEnv,
      );
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

    if (state.current === identity.id && !args.force) {
      if (output === "json") {
        logger.log(
          JSON.stringify(
            { site: state.name, id: identity.id, unchanged: true },
            null,
            2,
          ),
        );
        return;
      }
      logger.info(
        `No changes — deploy ${identity.id} is already live. Use --force to redeploy.`,
      );
      return;
    }

    const uploadSpin = spinner(`Uploading ${files.length} files...`);
    uploadSpin.start();
    try {
      await uploadDeploy(connection, identity.id, files, {
        onFileUploaded: (done, total) => {
          uploadSpin.text = `Uploading ${done}/${total} files (${formatBytes(totalBytes)} total)...`;
        },
      });
    } finally {
      uploadSpin.stop();
    }

    // Record the deploy. A re-deployed ID keeps its slot but gets fresh metadata.
    const record: DeployRecord = {
      id: identity.id,
      createdAt: new Date().toISOString(),
      source: identity.source,
      gitSha: identity.gitSha,
      dirty: identity.dirty,
      files: files.length,
      bytes: totalBytes,
      envHash: buildEnvHash,
    };
    state.deploys = [
      record,
      ...state.deploys.filter((d) => d.id !== record.id),
    ];
    if (args.promote !== false) {
      if (state.current && state.current !== identity.id) {
        state.previous = state.current;
      }
      state.current = identity.id;
    }
    await writeRemoteState(connection, state, etag);

    if (args.promote !== false) {
      const promoteSpin = spinner("Promoting to production...");
      promoteSpin.start();
      try {
        await promoteDeploy({
          computeClient,
          coreClient,
          state,
          deployId: identity.id,
        });
      } finally {
        promoteSpin.stop();
      }
    }

    // The system hostname comes from the pull zone; tolerate a fetch failure.
    let systemHost: string | undefined;
    try {
      const { data } = await coreClient.GET("/pullzone/{id}", {
        params: { path: { id: state.pullZoneId } },
      });
      systemHost =
        (data?.Hostnames ?? []).find((h) => h.IsSystemHostname)?.Value ??
        undefined;
    } catch {
      // URLs are informational only.
    }
    const urls = deployUrls(site, identity.id, systemHost);

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            site: state.name,
            id: identity.id,
            source: identity.source,
            files: files.length,
            bytes: totalBytes,
            promoted: args.promote !== false,
            production: urls.production ?? null,
            preview: urls.preview ?? null,
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(
      `Deployed ${identity.id} (${files.length} files, ${formatBytes(totalBytes)}).`,
    );
    if (args.promote !== false) {
      if (urls.production) logger.info(`Production: ${urls.production}`);
    } else {
      logger.info(
        `Uploaded without promoting. Publish it with \`bunny sites deployments publish ${identity.id}\`.`,
      );
    }
    if (urls.preview) logger.log(`  Preview:    ${urls.preview}`);

    await offerLink();
  },
});
