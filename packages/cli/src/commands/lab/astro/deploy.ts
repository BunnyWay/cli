/**
 * `bunny lab deploy astro`
 *
 * One Astro project that renders per request, on Edge Scripting and Bunny
 * Storage. Astro's server becomes a standalone Edge Script, and the client build
 * goes into a storage zone the script reads.
 *
 * Nothing here knows about `bunny sites`. The two commands deploy different
 * shapes, and sharing a state file made each of them carry checks for the shape
 * it is not.
 */
import { resolve } from "node:path";
import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { formatBytes } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { ignoreManifestDir } from "../../../core/manifest.ts";
import { readPackageJson } from "../../../core/package-manager.ts";
import { isInteractive, withSpinner } from "../../../core/ui.ts";
import { ADAPTER_PACKAGE, ensureAdapter } from "./adapter.ts";
import { buildCommand, run } from "./build.ts";
import { applyScriptEnv, resolveScriptEnv } from "./env.ts";
import {
  type LoadedBuildManifest,
  loadBuildManifest,
  requireAstroBuild,
  requireSsrBuild,
  resolveAssetsDir,
  resolveScriptEntry,
} from "./manifest.ts";
import { APP_NAME_RULES, appNameFrom, requireValidAppName } from "./naming.ts";
import { requireSupportedAstro, resolveProject } from "./project.ts";
import { applyPullZoneSettings, publishDeploy } from "./publish.ts";
import { DEFAULT_REGION, ensureResources } from "./resources.ts";
import { loadState, markCurrent, saveState } from "./state.ts";
import { connect, pruneDeploys } from "./storage.ts";
import {
  collectFiles,
  contentHash,
  hashFiles,
  uploadClientBuild,
} from "./upload.ts";
import { findMissingPageFault, findServingFault } from "./verify.ts";

/** Edge Scripting takes one JavaScript file of up to 10 MB. */
const SCRIPT_SIZE_LIMIT = 10 * 1024 * 1024;

/**
 * Above this, a published script often misses its 500 ms startup budget, and the
 * edge answers 400 with an empty body.
 *
 * Measured in August 2026 on a standalone script in DE, in the units this CLI
 * prints: the same code served every request at 7.44 MB (7,798,944 bytes) and
 * none at 7.83 MB (8,209,699 bytes). Nothing in the API reports this, so the only
 * place a developer can hear it is here.
 */
const SCRIPT_START_RISK = 7.5 * 1024 * 1024;

interface DeployArgs {
  dir?: string;
  name?: string;
  region?: string;
  build: boolean;
  yes: boolean;
  force: boolean;
}

/** The app name: `--name`, then the state, then the package's own name. */
async function resolveAppName(
  root: string,
  explicit: string | undefined,
): Promise<string> {
  if (explicit) return requireValidAppName(explicit);

  const state = loadState(root);
  if (state) return state.name;

  const pkg = await readPackageJson(root);
  const fromPackage =
    typeof pkg?.name === "string" ? appNameFrom(pkg.name) : null;
  if (fromPackage) return fromPackage;

  const fromDir = appNameFrom(resolve(root).split("/").pop() ?? "");
  if (fromDir) return fromDir;

  throw new UserError(
    "Couldn't work out a name for this app.",
    `Pass one: bunny lab deploy astro --name my-app\n${APP_NAME_RULES}`,
  );
}

/** Read the built bundle, and refuse a script the platform cannot take. */
async function readBundle(
  loaded: LoadedBuildManifest,
): Promise<{ code: string; bytes: number; sha256: string }> {
  const code = await Bun.file(resolveScriptEntry(loaded)).text();
  const bytes = Buffer.byteLength(code);
  if (bytes > SCRIPT_SIZE_LIMIT) {
    throw new UserError(
      `${loaded.manifest.script?.entry} is ${formatBytes(bytes)}, and Edge Scripting takes ${formatBytes(SCRIPT_SIZE_LIMIT)}.`,
      "Prerender the routes that need no server, or drop a dependency the server does not need, then build again.",
    );
  }
  return {
    code,
    bytes,
    sha256: new Bun.CryptoHasher("sha256").update(code).digest("hex"),
  };
}

export const labDeployAstroCommand = defineCommand<DeployArgs>({
  command: "astro [dir]",
  describe: "Deploy an Astro project that renders pages per request.",
  examples: [
    ["$0 lab deploy astro", "Build this project, then deploy it"],
    ["$0 lab deploy astro --name my-app", "Name the app it deploys to"],
    ["$0 lab deploy astro --no-build", "Deploy the build already on disk"],
    ["$0 lab deploy astro --yes", "Add the adapter without asking"],
  ],

  builder: (yargs) =>
    yargs
      .positional("dir", {
        type: "string",
        describe: "The project directory (default: the current one)",
      })
      .option("name", {
        type: "string",
        describe:
          "The app's name. Default: the state file, then the package's name",
      })
      .option("region", {
        type: "string",
        describe: `Storage region for a new app (default: ${DEFAULT_REGION})`,
      })
      .option("build", {
        type: "boolean",
        default: true,
        describe: "Run the project's build first (--no-build to skip)",
      })
      .option("yes", {
        alias: "y",
        type: "boolean",
        default: false,
        describe: "Install and configure the adapter without asking",
      })
      .option("force", {
        type: "boolean",
        default: false,
        describe: "Deploy even when nothing changed",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const json = output === "json";

    // 1. The project, and whether its Astro can run this adapter at all. The
    // version check comes before the install, because npm's own peer error is
    // not something a developer can act on.
    const root = await resolveProject(args.dir, output);
    await requireSupportedAstro(root);

    // 2. The adapter. Astro cannot build a route that renders on demand without
    // one, so this is the only change to somebody's source this command makes.
    await ensureAdapter({ root, output, assumeYes: args.yes });

    // 3. The build, before any resource exists.
    if (args.build) await run(await buildCommand(root), root);

    // 4. What the build says it produced.
    const loaded = await loadBuildManifest(root);
    if (!loaded) {
      throw new UserError(
        `${ADAPTER_PACKAGE} wrote no build manifest, so there is nothing to deploy.`,
        args.build
          ? "The build ran and wrote no .bunny/build.json. Report it to the adapter."
          : "Build the project first, or drop --no-build.",
      );
    }
    requireAstroBuild(loaded);
    requireSsrBuild(loaded);

    const bundle = await readBundle(loaded);
    const assetsDir = resolveAssetsDir(loaded);

    const appName = await resolveAppName(root, args.name);

    const config = resolveConfig(profile, apiKey, verbose);
    const options = clientOptions(config, verbose);
    const coreClient = createCoreClient(options);
    const computeClient = createComputeClient(options);

    // 5. The files. Hashed before anything is created, so the deploy's own name
    // is known and an unchanged deploy can be recognised.
    const files = await withSpinner("Hashing the client build...", () =>
      hashFiles(collectFiles(assetsDir)),
    );
    if (files.length === 0) {
      throw new UserError(
        `Nothing to deploy; ${loaded.manifest.assets.dir} has no files.`,
        "Dotfiles and node_modules are excluded.",
      );
    }
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    const deployId = contentHash(files, bundle.sha256);

    const previous = loadState(root);
    if (
      !args.force &&
      previous?.contentHash === deployId &&
      previous.current === deployId
    ) {
      const url = previous.hostname ? `https://${previous.hostname}` : null;
      if (json) {
        logger.log(
          JSON.stringify(
            { app: appName, id: deployId, unchanged: true, url },
            null,
            2,
          ),
        );
        return;
      }
      logger.info(
        `No changes: deploy ${deployId} is already live. Use --force to deploy it again.`,
      );
      if (url) logger.log(`  ${url}`);
      return;
    }

    // 6. The resources. Each one is looked up before it is made.
    const created = await withSpinner(`Preparing "${appName}"...`, (spin) =>
      ensureResources({
        coreClient,
        computeClient,
        appName,
        region: args.region ?? DEFAULT_REGION,
        onStep: (message) => {
          spin.text = message;
        },
      }),
    );
    const state = {
      ...created.state,
      ...(previous?.name === appName
        ? { current: previous.current, previous: previous.previous }
        : {}),
    };
    const zone = created.storageZone;
    const first = previous?.current === undefined;

    saveState(root, state);
    if (ignoreManifestDir(root)) {
      logger.dim(
        "  Added .bunny/ to .gitignore; it holds the link to this app.",
      );
    }

    // 7. The pull zone's settings, before a page is served through it. A site
    // that answers while the zone still strips Set-Cookie looks broken in a way
    // nothing explains.
    const changed = await withSpinner("Checking the pull zone...", () =>
      applyPullZoneSettings(
        coreClient,
        state.pullZoneId,
        loaded.manifest.requires?.pullZone,
      ),
    );
    if (changed.length > 0 && !json) {
      logger.info(`Applied the pull zone settings: ${changed.join(", ")}.`);
    }

    // 8. The variables the script reads.
    const { entries, unset } = resolveScriptEnv(
      loaded.manifest,
      zone,
      state.pullZoneId,
    );
    const set = await withSpinner("Setting the script's variables...", () =>
      applyScriptEnv(computeClient, state.scriptId, entries),
    );
    if (set.length > 0 && !json) {
      logger.info(`Set ${set.length} script variable(s): ${set.join(", ")}.`);
    }

    // 9. The files, then the code. In that order, always: a script published
    // before its assets are up would render pages naming files that are not
    // there yet.
    const connection = connect(zone);
    let sent = 0;
    await withSpinner(`Uploading ${files.length} files...`, (spin) =>
      uploadClientBuild(connection, deployId, files, (done, total, file) => {
        // Bytes, not only files: a large build spends minutes here, and a file
        // count says nothing about how much of it is left.
        sent += file.size;
        spin.text = `Uploading ${done}/${total} files (${formatBytes(sent)} of ${formatBytes(totalBytes)})...`;
      }),
    );

    const published = await withSpinner("Publishing...", () =>
      publishDeploy({
        computeClient,
        coreClient,
        scriptId: state.scriptId,
        pullZoneId: state.pullZoneId,
        code: bundle.code,
        deploy: {
          id: deployId,
          assetPrefix: `deploys/${deployId}`,
          site: appName,
        },
      }),
    );

    markCurrent(state, deployId);
    state.contentHash = deployId;
    saveState(root, state);

    // 10. The old deploys. Nothing can publish one, because there is no
    // rollback, and the one before this release keeps its files for a moment
    // longer in case a node is still serving it.
    const pruned = await withSpinner("Pruning old deploys...", () =>
      pruneDeploys(connection, [deployId, state.previous ?? ""]),
    );

    const url = state.hostname ? `https://${state.hostname}` : null;

    // 11. The check. A green line above a URL that answers 400 is the worst
    // thing this command can do.
    const fault = url
      ? await withSpinner("Checking the site...", () =>
          findServingFault(url, deployId),
        )
      : null;
    const missing =
      url && fault === null
        ? await withSpinner("Checking a missing page...", () =>
            findMissingPageFault(url, deployId),
          )
        : null;

    if (json) {
      logger.log(
        JSON.stringify(
          {
            app: appName,
            id: deployId,
            url,
            files: files.length,
            bytes: totalBytes,
            scriptBytes: bundle.bytes,
            release: published.release ?? null,
            storageZone: state.storageZone,
            scriptId: state.scriptId,
            pullZoneId: state.pullZoneId,
            pruned,
            serving: fault === null,
            ...(fault === null ? {} : { status: fault }),
            ...(missing === null ? {} : { notFoundStatus: missing }),
            unsetEnv: unset,
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(
      `Deployed ${deployId}: ${files.length} files (${formatBytes(totalBytes)}), script ${formatBytes(bundle.bytes)}.`,
    );
    if (url) logger.info(`  ${url}`);
    if (first) {
      logger.dim(`  storage zone   ${state.storageZone}`);
      logger.dim(`  edge script    ${state.scriptId}`);
      logger.dim(`  pull zone      ${state.pullZoneId}`);
    }

    if (fault !== null) {
      logger.warn(`The site answered ${fault}, so the script is not serving.`);
      if (bundle.bytes > SCRIPT_START_RISK) {
        logger.dim(
          `  The script is ${formatBytes(bundle.bytes)}, and a script has 500 ms to start. Every byte is parsed first.`,
        );
        logger.dim(
          "  Measured in August 2026: the same code served every request at 7.4 MB, and none at 7.8 MB.",
        );
        logger.dim(
          "  Prerender a route, or drop a dependency the server does not need, then deploy again.",
        );
      } else {
        logger.dim(
          "  The script may be failing as it starts. Read its logs in the dashboard: Scripting > your script > Logs.",
        );
      }
    } else if (missing !== null) {
      logger.warn(
        `A path this site does not hold answered with bunny.net's error page (${missing}), not Astro's.`,
      );
      logger.dim(
        "  Check the script's logs in the dashboard: Scripting > your script > Logs.",
      );
    }

    const named = unset.filter((name) => name !== "BUNNY_API_KEY");
    if (named.length > 0) {
      logger.dim(
        `  ${ADAPTER_PACKAGE} also reads ${named.join(", ")}. Set them with \`bunny scripts env set\`.`,
      );
    }
    if (unset.includes("BUNNY_API_KEY")) {
      logger.dim(
        "  Cache purging needs an account API key: bunny scripts env set BUNNY_API_KEY <key> --secret",
      );
    }
    if (!isInteractive(output)) return;
    logger.dim("  Take it down again: bunny lab undeploy astro");
  },
});
