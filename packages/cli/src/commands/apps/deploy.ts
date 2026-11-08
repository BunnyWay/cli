import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { RegistryMap } from "@bunny.net/config";
import { createMcClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/magic-containers";
import { type ResolvedConfig, resolveConfig } from "@/config/index.ts";
import {
  fetchRegistryNamespace,
  REGISTRY_USERNAME,
} from "@/core/bunny-registry.ts";
import { clientOptions } from "@/core/client-options.ts";
import { bunny } from "@/core/colors.ts";
import { defineCommand } from "@/core/define-command.ts";
import { ApiError, UserError } from "@/core/errors.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { loadManifest, saveManifest } from "@/core/manifest.ts";
import type { OutputFormat } from "@/core/types.ts";
import { isInteractive, spinner } from "@/core/ui.ts";
import {
  apiToConfig,
  assertVolumesNotSplit,
  type BunnyAppConfig,
  type ContainerConfig,
  configExists,
  configToAddRequest,
  configToContainerRequest,
  loadConfig,
  normalizeRegions,
  parseImageRef,
  resolveContainerRegistry,
  saveConfig,
} from "./config.ts";
import { APP_MANIFEST, type AppManifest } from "./constants.ts";

/**
 * Extract the per-container registry IDs we have so far into the
 * registry-override map expected by `configToAddRequest` and
 * `configToContainerRequest`. Empty entries are omitted so they don't
 * accidentally clear a registry on the server.
 */
function draftRegistries(
  containers: AppManifest["containers"],
): RegistryMap | undefined {
  const map: RegistryMap = {};
  let any = false;
  for (const [name, entry] of Object.entries(containers)) {
    if (entry.registry) {
      map[name] = entry.registry;
      any = true;
    }
  }
  return any ? map : undefined;
}

/**
 * Ask bunny.net for endpoint/env suggestions for an image we just
 * pushed, and prompt the user to merge them into `targetContainer`.
 *
 * The API call is the source of truth - it can see the image manifest
 * and apply well-known patterns (Postgres → 5432, Node images → 3000,
 * etc.). When it returns nothing useful (network error, registry
 * doesn't expose the manifest), we fall back to parsing `EXPOSE` out
 * of the local Dockerfile so the user isn't left with no endpoints.
 *
 * Suggestions already covered by `targetContainer.endpoints` (by
 * container port) or `targetContainer.env` (by name) are filtered out
 * before prompting - avoids re-asking about ports the walkthrough
 * already added.
 */
async function applyPostPushSuggestions(
  client: ReturnType<typeof createMcClient>,
  registryId: string,
  imageRef: string,
  _mode: { kind: "build"; dockerfile: string },
  opts: {
    targetContainer: ContainerConfig;
    dockerfilePath: string;
    interactive: boolean;
  },
): Promise<void> {
  const parsed = parseImageRef(imageRef);
  const suggestions = await getConfigSuggestions(client, registryId, parsed);

  let endpointSuggestions = suggestions?.endpointSuggestions ?? [];
  const envSuggestions = suggestions?.environmentVariablesSuggestions ?? [];

  // Fallback: if the API didn't return endpoint suggestions, derive
  // them from the Dockerfile's EXPOSE directives. Only triggers when
  // the API call genuinely returned nothing - otherwise we trust the
  // backend's view.
  if (endpointSuggestions.length === 0) {
    const dockerfileAbs = resolve(process.cwd(), opts.dockerfilePath);
    const exposedPorts = await readDockerfileExposedPorts(dockerfileAbs);
    if (exposedPorts.length > 0) {
      endpointSuggestions = exposedPorts.map((port) => ({
        displayName: "cdn",
        cdn: {
          isSslEnabled: true,
          portMappings: [{ exposedPort: 443, containerPort: port }],
        },
      }));
    }
  }

  if (suggestions?.instructions) {
    logger.log();
    logger.dim(suggestions.instructions);
    logger.log();
  }

  const newEndpoints = filterNewEndpointSuggestions(
    endpointSuggestions,
    opts.targetContainer,
  );
  if (newEndpoints.length > 0 && opts.interactive) {
    const accepted = await confirmEndpointSuggestions(newEndpoints);
    if (accepted.length > 0) {
      opts.targetContainer.endpoints = [
        ...(opts.targetContainer.endpoints ?? []),
        ...accepted.map(endpointRequestToConfig),
      ];
    }
  }

  const newEnvs = filterNewEnvSuggestions(envSuggestions, opts.targetContainer);
  if (newEnvs.length > 0 && opts.interactive) {
    const env = await promptSuggestedEnv(newEnvs);
    if (Object.keys(env).length > 0) {
      opts.targetContainer.env = {
        ...env,
        ...(opts.targetContainer.env ?? {}),
      };
    }
  }
}

import {
  BUNNY_REGISTRY_ID,
  buildImage,
  buildImageRef,
  dockerLogin,
  ensureDockerAvailable,
  ensureRegistryLogin,
  generateTag,
  getConfigSuggestions,
  getRegistry,
  imageHostname,
  normalizeRegistryFlag,
  promptRegistry,
  pushImage,
  type ResolvedRegistry,
  readDockerfileExposedPorts,
  resolveRegistryForImage,
} from "./docker.ts";
import {
  collectDeployedEndpoints,
  type DeployedEndpointLine,
} from "./endpoints/format.ts";
import { resolveContainerEnv } from "./env/resolve.ts";
import {
  confirmEndpointSuggestions,
  endpointRequestToConfig,
  filterNewEndpointSuggestions,
  filterNewEnvSuggestions,
  promptSuggestedEnv,
} from "./suggestions.ts";
import { runWalkthrough } from "./walkthrough.ts";

const COMMAND = "deploy [image]";
const DESCRIPTION = "Deploy an app.";
const DEFAULT_DOCKERFILE = "Dockerfile";

interface DeployArgs {
  image?: string;
  "allow-split-volumes"?: boolean;
  force?: boolean;
  "add-alongside"?: boolean;
  region?: string;
  dockerfile?: string | boolean;
  context?: string;
  tag?: string;
  registry?: string;
  container?: string;
  name?: string;
  port?: number;
  command?: string;
  config?: string;
  "dry-run"?: boolean;
  push?: boolean;
}

export const appsDeployCommand = defineCommand<DeployArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 apps deploy ghcr.io/me/api:v1.2", "Deploy a pre-built image"],
    [
      "$0 apps deploy --dockerfile",
      "Build ./Dockerfile and deploy, generating it when there is none",
    ],
    [
      "$0 apps deploy --dockerfile --region de --output json",
      "First deploy without prompts (agents)",
    ],
    [
      "$0 apps deploy --dockerfile apps/api/Dockerfile --context apps/api",
      "Build with explicit context",
    ],
    ["$0 apps deploy --dry-run", "Preview the would-be config without writing"],
    ["$0 apps deploy", "Re-deploy using config from bunny.jsonc"],
  ],

  builder: (yargs) =>
    yargs
      .positional("image", {
        type: "string",
        describe:
          "Container image reference to deploy (e.g. ghcr.io/me/api:v1)",
      })
      .option("dockerfile", {
        type: "string",
        describe:
          "Build from Dockerfile, then deploy. Pass a path or use bare flag for ./Dockerfile.",
      })
      .option("context", {
        type: "string",
        describe:
          "Docker build context directory (defaults to dirname of Dockerfile)",
      })
      .option("tag", {
        type: "string",
        describe: "Override the auto-generated image tag",
      })
      .option("registry", {
        type: "string",
        describe:
          'Registry ID to push to, or "bunny" for the bunny.net registry (overrides bunny.jsonc)',
      })
      .option("container", {
        type: "string",
        describe:
          "Target container by name (required when bunny.jsonc has multiple containers)",
      })
      .option("name", {
        type: "string",
        describe:
          "App name (used during first-run walkthrough; skips the interactive prompt)",
      })
      .option("region", {
        type: "string",
        describe:
          "Region ID for a new app (skips the interactive prompt; required without a terminal)",
      })
      .option("port", {
        type: "number",
        describe:
          "Override the container port (affects generated Dockerfile and endpoint)",
      })
      .option("command", {
        type: "string",
        describe:
          "Override the container CMD (passed as a single string, split on whitespace)",
      })
      .option("config", {
        type: "string",
        describe:
          "Use this file as the app config (overrides cwd-detected bunny.jsonc). Useful in CI / agent flows where no bunny.jsonc is checked in.",
      })
      .option("dry-run", {
        type: "boolean",
        describe:
          "Print the would-be bunny.jsonc and Dockerfile without writing anything or contacting the API to deploy",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        hidden: true,
      })
      .option("add-alongside", {
        type: "boolean",
        describe:
          "Add a container even when the app has containers bunny.jsonc doesn't list",
      })
      .option("allow-split-volumes", {
        type: "boolean",
        describe:
          "Deploy a volume to more than one region or instance, each keeping its own separate data",
      })
      .option("push", {
        type: "boolean",
        describe:
          "Push and deploy after building (default: true). Use --no-push to build only.",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const positionalImage = args.image;
    const dockerfileFlag = normalizeDockerfileFlag(args.dockerfile);
    const registryFlag = normalizeRegistryFlag(args.registry);
    const noPush = args.push === false;
    const dryRun = args["dry-run"] === true;

    // --config takes precedence over the cwd-walk for bunny.jsonc. When
    // set, we read/write *that exact* path. Useful for agents and CI
    // that generate ephemeral configs without checking anything in.
    const configPath = args.config
      ? resolve(process.cwd(), args.config)
      : undefined;

    // `.env` lives next to bunny.jsonc. Container env values that match a
    // key in this file are resolved at deploy time; everything else is
    // sent literally. See resolveContainerEnv for the full rule.
    const dotenvPath = configPath
      ? resolve(dirname(configPath), ".env")
      : resolve(process.cwd(), ".env");

    if (positionalImage && dockerfileFlag) {
      throw new UserError(
        "Cannot use both <image> and --dockerfile at the same time.",
        "Pass an image to deploy a pre-built ref, or --dockerfile to build locally.",
      );
    }

    // Fail fast when the user's flags already commit us to a build. The
    // walkthrough also checks this on its interactive picks, but for
    // `--dockerfile` (with no existing config) the choice is implicit so
    // it'd otherwise skip the menu and only blow up after writing files.
    if (dockerfileFlag && !dryRun) {
      await ensureDockerAvailable();
    }

    const cfg = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(cfg, verbose));

    let toml: BunnyAppConfig;
    /** Registries the walkthrough resolved, to seed the manifest draft below. */
    let walkthroughRegistries: Record<string, string> = {};
    const linkedId = loadManifest<AppManifest>(APP_MANIFEST).id;
    if (!configExists(configPath) && linkedId) {
      // Linked apps deploy without bunny.jsonc: the live app supplies everything but the new image.
      if (!positionalImage && !dockerfileFlag) {
        throw new UserError(
          "This directory has no bunny.jsonc, so there is nothing to redeploy.",
          "Pass an image (`bunny apps deploy <image>`) or `--dockerfile` to build one.",
        );
      }
      const { data: app } = await client.GET("/apps/{appId}", {
        params: { path: { appId: linkedId } },
      });
      if (!app) throw new UserError(`App ${linkedId} not found.`);
      toml = apiToConfig(app);
    } else if (!configExists(configPath)) {
      const result = await runWalkthrough(client, {
        positionalImage,
        dockerfileFlag,
        contextFlag: args.context,
        registryFlag,
        portOverride: args.port,
        commandOverride: args.command,
        nameOverride: args.name,
        regionFlag: args.region,
        interactive: isInteractive(output),
        buildsImage: !dryRun,
        configPath,
        dryRun,
      });
      toml = result.config;
      walkthroughRegistries = result.registries;
    } else {
      toml = loadConfig(configPath);
      // Config regions and scaling only apply on create; an existing app is checked live when a container is added.
      if (!(linkedId ?? toml.app.id)) {
        assertVolumesNotSplit(toml, args["allow-split-volumes"]);
      }
      // Existing config: bail before any registry prompts if a container
      // declares a `dockerfile` (we'll need Docker to build it).
      const hasAnyBuild = Object.values(toml.app.containers).some((c) =>
        Boolean(c.dockerfile),
      );
      if (hasAnyBuild && !dryRun) {
        await ensureDockerAvailable();
      }
    }

    // Build a writable draft of the manifest for this deploy run. We
    // save eagerly after each piece of state we resolve (app ID,
    // per-container registry, per-container template ID) so a mid-deploy
    // crash doesn't lose what we've learned.
    const existingManifest = loadManifest<AppManifest>(APP_MANIFEST);
    const draft: {
      id?: string;
      profile?: string;
      containers: AppManifest["containers"];
    } = {
      id: existingManifest.id ?? toml.app.id,
      profile: existingManifest.profile ?? profile,
      containers: { ...(existingManifest.containers ?? {}) },
    };
    // Seed with any registry picks the walkthrough just resolved so
    // we don't re-prompt below for the same registry.
    for (const [name, registryId] of Object.entries(walkthroughRegistries)) {
      draft.containers[name] = {
        ...draft.containers[name],
        registry: registryId,
      };
    }
    // Never create bunny.jsonc for a linked app deployed without one.
    const persistConfig = () => {
      if (configExists(configPath)) saveConfig(toml, configPath);
    };
    const persistDraft = () => {
      if (!draft.id) return;
      saveManifest<AppManifest>(APP_MANIFEST, {
        id: draft.id,
        profile: draft.profile,
        containers: draft.containers,
      });
    };
    const setContainerRegistry = (name: string, registryId: string) => {
      draft.containers[name] = {
        ...draft.containers[name],
        registry: registryId,
      };
      persistDraft();
    };
    const setContainerTemplateId = (name: string, templateId: string) => {
      draft.containers[name] = { ...draft.containers[name], id: templateId };
      persistDraft();
    };

    if (dryRun) {
      logger.log();
      logger.dim("--- bunny.jsonc (preview) ---");
      logger.log(JSON.stringify(toml, null, 2));
      logger.dim("--- end preview ---");
      logger.dim(
        "Dry run complete. No files were written and no API calls were made to deploy.",
      );
      return;
    }

    // Multi-container deploys build or resolve every container, then create or update the app in one request.
    const containerEntries = Object.entries(toml.app.containers);
    if (
      containerEntries.length > 1 &&
      !positionalImage &&
      !dockerfileFlag &&
      !args.container
    ) {
      const built = await prepareContainers(client, toml, configPath, {
        tag: args.tag,
        contextOverride: args.context,
        draftContainers: draft.containers,
        onRegistryResolved: setContainerRegistry,
        cfg,
        verbose,
        registryFlag,
        quiet: output === "json",
        noPush,
        suggest: !draft.id,
      });

      if (noPush) {
        logger.dim("Skipping push and deploy (--no-push).");
        if (output === "json") {
          logger.log(
            JSON.stringify({ built: true, images: built, pushed: false }),
          );
        }
        return;
      }

      const config = resolveContainerEnv(toml, dotenvPath);
      const registries = draftRegistries(draft.containers);
      let appId = draft.id;

      if (appId) {
        await applyImages(
          client,
          appId,
          config,
          Object.keys(config.app.containers),
          registries,
          {
            allowSplitVolumes: args["allow-split-volumes"],
            addAlongside: args["add-alongside"],
          },
        );
      } else {
        const createSpin = spinner("Creating app...");
        createSpin.start();
        const { data: result } = await client.POST("/apps", {
          body: configToAddRequest(config, registries),
        });
        createSpin.stop();

        if (!result?.id) {
          throw new UserError("Failed to create app — no ID returned.");
        }

        appId = result.id;
        draft.id = appId;
        persistDraft();
        logger.success(`App "${toml.app.name}" created (${appId}).`);
      }

      const fetchSpin = spinner("Recording container IDs...");
      fetchSpin.start();
      const { data: savedApp } = await client.GET("/apps/{appId}", {
        params: { path: { appId } },
      });
      fetchSpin.stop();

      for (const ct of savedApp?.containerTemplates ?? []) {
        setContainerTemplateId(ct.name, ct.id);
      }

      const deploySpin = spinner("Deploying...");
      deploySpin.start();
      await client.POST("/apps/{appId}/deploy", {
        params: { path: { appId } },
      });
      deploySpin.stop();

      const endpoints = await fetchDeployedEndpoints(client, appId);

      if (output === "json") {
        logger.log(JSON.stringify({ id: appId, deployed: true, endpoints }));

        return;
      }

      logger.success("Your app was deployed successfully 🪄", bunny);
      printDeployedEndpoints(endpoints, output);
      return;
    }

    const [targetName, targetContainer] = resolveTargetContainer(toml, {
      explicit: args.container,
      hasImageOrBuild: Boolean(positionalImage || dockerfileFlag),
    });

    const mode = resolveMode({
      positionalImage,
      dockerfileFlag,
      container: targetContainer,
    });

    let deployImage: string | undefined;
    let registryId: string | undefined = resolveDeployRegistry(
      registryFlag,
      draft.containers[targetName]?.registry,
      () => resolveContainerRegistry(targetName, targetContainer),
    );
    let freshCreds: ResolvedRegistry["freshCredentials"];

    if (mode.kind === "build") {
      assertDockerfileExists(mode.dockerfile, targetName);

      // Ensure a registry is selected before we build (we need its hostname).
      if (!registryId) {
        const resolved = await promptRegistry(client);
        if (!resolved) {
          throw new UserError(
            "A registry is required to build and push images.",
          );
        }
        registryId = resolved.id;
        freshCreds = resolved.freshCredentials;
      }
      setContainerRegistry(targetName, registryId);

      const regSpin = spinner("Fetching registry...");
      regSpin.start();
      const reg = await getRegistry(client, registryId);
      regSpin.stop();

      if (!reg?.hostName) {
        throw new UserError(
          `Registry ${registryId} not found or has no hostname.`,
          "Use `bunny apps registries list` to check your registries.",
        );
      }

      // The bunny.net registry record is public (no userName):
      // repositories are namespaced by account id and pushes
      // authenticate with the API token.
      const isBunnyRegistry = registryId === BUNNY_REGISTRY_ID;
      const namespace = isBunnyRegistry
        ? await fetchRegistryNamespace(cfg, verbose)
        : reg.userName;

      const tag = args.tag ?? (await generateTag());
      const imageRef = buildImageRef(
        reg.hostName,
        namespace,
        toml.app.name,
        tag,
      );
      const buildCwd = resolveBuildContext(mode.dockerfile, args.context);

      // Check the docker login before building so a wrong account fails fast.
      if (!noPush && !isBunnyRegistry && !freshCreds) {
        await ensureRegistryLogin(
          reg.hostName,
          reg.userName,
          isInteractive(output),
        );
      }

      logger.info(`Building ${imageRef}...`);
      await buildImage(mode.dockerfile, imageRef, buildCwd, {
        quiet: output === "json",
      });

      if (noPush) {
        logger.success(`Image built: ${imageRef}`);
        logger.dim("Skipping push and deploy (--no-push).");
        if (output === "json") {
          logger.log(
            JSON.stringify({ built: true, image: imageRef, pushed: false }),
          );
        }
        return;
      }

      if (isBunnyRegistry) {
        if (!cfg.apiKey) {
          throw new UserError(
            "Not logged in.",
            'Run "bunny login" to authenticate.',
          );
        }
        const loginSpin = spinner(`Logging in to ${reg.hostName}...`);
        loginSpin.start();
        try {
          await dockerLogin(reg.hostName, REGISTRY_USERNAME, cfg.apiKey);
        } finally {
          loginSpin.stop();
        }
      } else if (freshCreds) {
        const loginSpin = spinner(`Logging in to ${reg.hostName}...`);
        loginSpin.start();
        try {
          await dockerLogin(
            reg.hostName,
            freshCreds.userName,
            freshCreds.password,
          );
        } finally {
          loginSpin.stop();
        }
      }

      logger.info(`Pushing ${imageRef}...`);
      await pushImage(imageRef, { quiet: output === "json" });

      deployImage = imageRef;
      // In-memory only - `saveConfig` strips `image` for dockerfile
      // containers via `stripTransientFields`. The MC API is the source
      // of truth for what's deployed; `bunny.jsonc` stores intent only.
      // The mutation is still needed for `configToAddRequest` and
      // `applyImages` to read the ref in the same deploy run.
      targetContainer.image = imageRef;
      // Persist dockerfile/context if they came from flags so the manifest stays the source of truth.
      if (!targetContainer.dockerfile) {
        targetContainer.dockerfile = mode.dockerfile;
      }
      if (args.context && !targetContainer.context) {
        targetContainer.context = args.context;
      }

      // Now that the image is live in the registry, ask bunny.net to
      // analyze it. This is the same `getConfigSuggestions` call we
      // make for pre-built images during the walkthrough - it returns
      // endpoint and env-var hints derived from the image manifest /
      // known-image patterns. For a fresh first deploy we usually have
      // no endpoints yet, so this is what populates them.
      if (registryId && !draft.id) {
        await applyPostPushSuggestions(client, registryId, imageRef, mode, {
          targetContainer,
          dockerfilePath: mode.dockerfile,
          interactive: isInteractive(output),
        });
      }

      persistConfig();
    }

    if (mode.kind === "redeploy") deployImage = mode.image;

    if (mode.kind === "redeploy" && !registryId) {
      const resolved = await resolveRegistryForImage(client, mode.image);
      if (!resolved) {
        throw new UserError(`A registry is required to deploy ${mode.image}.`);
      }

      registryId = resolved.id;
      setContainerRegistry(targetName, registryId);
    }

    if (mode.kind === "image") {
      const resolved = await resolveRegistryForImage(client, mode.image);
      if (!resolved) {
        throw new UserError(
          "A registry is required to deploy this image.",
          "bunny.net needs a registry record for the image hostname so it can pull the image.",
        );
      }
      registryId = resolved.id;
      deployImage = mode.image;
      // `image` is a pinned upstream ref - keep it in bunny.jsonc (intent).
      // Registry is account-scoped - record in the manifest instead.
      targetContainer.image = mode.image;
      setContainerRegistry(targetName, registryId);
      persistConfig();
    }

    // Captured before the create-or-patch so the rollback hint at the
    // bottom can suppress itself on a first-time deploy. The GET we issue
    // after creating an app can return a canonical `image` ref that
    // doesn't byte-equal what we just pushed (the API stores the parts —
    // imageName/Namespace/Tag — and may reconstruct the full ref
    // differently), which would otherwise make `previousImage !== deployImage`
    // accidentally true and surface a misleading rollback hint.
    const isFirstDeploy = !draft.id;

    // Read before the config PATCH below, which already applies the new image.
    let previousImage: string | undefined;

    let appId = draft.id;
    if (!appId) {
      const createSpin = spinner("Creating app...");
      createSpin.start();

      const { data: result } = await client.POST("/apps", {
        body: configToAddRequest(
          resolveContainerEnv(toml, dotenvPath),
          draftRegistries(draft.containers),
        ),
      });
      createSpin.stop();

      if (!result?.id) {
        throw new UserError("Failed to create app — no ID returned.");
      }

      appId = result.id;
      draft.id = appId;
      persistDraft();

      logger.success(`App "${toml.app.name}" created (${appId}).`);
    } else {
      const fetchSpin = spinner("Fetching app...");
      fetchSpin.start();
      const { data: existingApp } = await client.GET("/apps/{appId}", {
        params: { path: { appId } },
      });
      fetchSpin.stop();

      if (!existingApp) throw new UserError(`App ${appId} not found.`);

      const previous = findTemplate(
        existingApp,
        targetName,
        Object.keys(toml.app.containers).length,
      )?.image;
      const deployHost = deployImage ? imageHostname(deployImage) : null;

      if (deployImage && previous) {
        previousImage =
          deployHost && !imageHostname(previous)
            ? `${deployHost}/${previous}`
            : previous;
      }

      await applyImages(
        client,
        appId,
        resolveContainerEnv(toml, dotenvPath),
        [targetName],
        draftRegistries(draft.containers),
        {
          allowSplitVolumes: args["allow-split-volumes"],
          addAlongside: args["add-alongside"],
        },
        existingApp,
      );
      if (deployImage) logger.success(`Image updated to ${deployImage}.`);
    }

    const { data: savedApp } = await client.GET("/apps/{appId}", {
      params: { path: { appId } },
    });
    for (const ct of savedApp?.containerTemplates ?? []) {
      setContainerTemplateId(ct.name, ct.id);
    }

    const deploySpin = spinner("Deploying...");
    deploySpin.start();
    await client.POST("/apps/{appId}/deploy", {
      params: { path: { appId } },
    });
    deploySpin.stop();

    const endpoints = await fetchDeployedEndpoints(client, appId);

    if (output === "json") {
      logger.log(
        JSON.stringify({
          id: appId,
          deployed: true,
          image: deployImage,
          previousImage,
          endpoints,
        }),
      );
      return;
    }

    logger.success("Your app was deployed successfully 🪄", bunny);
    printDeployedEndpoints(endpoints, output);

    // Rollback hint, only meaningful when this is a redeploy of an
    // existing app and we just replaced its image with a different one.
    // On a first-time deploy there's nothing to roll back to.
    if (!isFirstDeploy && previousImage && previousImage !== deployImage) {
      logger.log();
      logger.dim(`Previous image: ${previousImage}`);
      const containerFlag =
        Object.keys(toml.app.containers).length > 1
          ? ` --container ${targetName}`
          : "";
      logger.dim(
        `To rollback:    bunny apps deploy ${previousImage}${containerFlag}`,
      );
    }
  },
});

type App = components["schemas"]["Application"];

/** The live template for a config container, matched by name, or the only one when both sides have one container. */
function findTemplate(app: App, name: string, configCount: number) {
  const templates = app.containerTemplates ?? [];
  return (
    templates.find((t) => t.name.toLowerCase() === name.toLowerCase()) ??
    (templates.length === 1 && configCount === 1 ? templates[0] : undefined)
  );
}

// Deploy never applies these, so say when bunny.jsonc and the app disagree instead of ignoring the file silently.
function warnIgnoredSettings(toml: BunnyAppConfig, app: App, count: number) {
  const notes: string[] = [];
  const scaling = toml.app.scaling;
  const live = app.autoScaling;
  if (
    scaling &&
    live &&
    (scaling.min !== live.min || scaling.max !== live.max)
  ) {
    notes.push(
      `scaling: bunny.jsonc ${scaling.min}-${scaling.max}, app ${live.min}-${live.max}`,
    );
  }
  if (toml.app.regions) {
    const want = normalizeRegions(toml.app.regions);
    const same = (a: string[], b: string[]) =>
      a.length === b.length && a.every((id) => b.includes(id.toUpperCase()));
    const allowed = app.regionSettings.allowedRegionIds.map((id) =>
      id.toUpperCase(),
    );
    const required = app.regionSettings.requiredRegionIds.map((id) =>
      id.toUpperCase(),
    );
    if (!same(want.allowed, allowed) || !same(want.required, required)) {
      notes.push(
        `regions: bunny.jsonc ${want.allowed.join(", ")}, app ${allowed.join(", ") || "none"}`,
      );
    }
  }
  for (const [name, container] of Object.entries(toml.app.containers)) {
    const template = findTemplate(app, name, count);
    if (!template || !container.env) continue;
    const liveKeys = new Set(template.environmentVariables?.map((v) => v.name));
    const missing = Object.keys(container.env).filter((k) => !liveKeys.has(k));
    if (missing.length > 0) {
      notes.push(`env on "${name}": ${missing.join(", ")} not set on the app`);
    }
  }
  if (notes.length === 0) return;

  logger.warn(
    "bunny.jsonc differs from the app. Deploy only updates images, so the app keeps its own:",
  );
  for (const note of notes) logger.dim(`  ${note}`);
  logger.dim(
    "Change them with `bunny apps scale`, `bunny apps regions set` or `bunny apps env set`, or run `bunny apps pull` to update bunny.jsonc.",
  );
}

// The volumes list replaces the app's by name, so it must carry every live volume exactly as read, or the missing ones lose their data.
async function addVolumes(
  client: ReturnType<typeof createMcClient>,
  appId: string,
  add: Map<string, number>,
): Promise<void> {
  const { data } = await client.GET("/apps/{appId}", {
    params: { path: { appId } },
  });
  const live = data?.volumes;
  const valid =
    Array.isArray(live) &&
    live.every((v) => typeof v.name === "string" && typeof v.size === "number");
  if (!valid) {
    throw new UserError(
      `Couldn't read the volumes on app ${appId}, so no volume was added.`,
      "Try the deploy again, or add the volume in the bunny.net dashboard.",
    );
  }

  const volumes = live.map(({ name, size }) => ({ name, size }));
  for (const [name, size] of add) {
    if (!volumes.some((v) => v.name === name)) volumes.push({ name, size });
  }
  if (volumes.length === live.length) return;

  const spin = spinner("Adding volumes...");
  spin.start();
  try {
    await client.PATCH("/apps/{appId}", {
      params: { path: { appId } },
      body: { volumes },
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      throw new UserError(
        `Couldn't add volumes to app ${appId}: ${error.message}`,
        "If a volume on this app is being resized, wait for it to finish and deploy again; a volume already created is reused, not duplicated.",
      );
    }
    throw error;
  } finally {
    spin.stop();
  }
}

// Deploy only swaps images (adding containers the app lacks), so every other live setting stays as it is.
async function applyImages(
  client: ReturnType<typeof createMcClient>,
  appId: string,
  toml: BunnyAppConfig,
  names: string[],
  registries: RegistryMap | undefined,
  opts: { allowSplitVolumes?: boolean; addAlongside?: boolean },
  existing?: App,
): Promise<void> {
  let app = existing;
  if (!app) {
    const { data } = await client.GET("/apps/{appId}", {
      params: { path: { appId } },
    });
    if (!data) throw new UserError(`App ${appId} not found.`);
    app = data;
  }

  const count = Object.keys(toml.app.containers).length;
  const added = names.filter(
    (name) =>
      toml.app.containers[name]?.image && !findTemplate(app, name, count),
  );
  warnIgnoredSettings(toml, app, count);

  // A container missing on both sides is most likely a rename, and adding it would run a second copy next to the old one.
  const configNames = Object.keys(toml.app.containers);
  const unlisted = app.containerTemplates.filter(
    (t) => !configNames.some((n) => findTemplate(app, n, count)?.id === t.id),
  );
  if (added.length > 0 && unlisted.length > 0 && !opts.addAlongside) {
    throw new UserError(
      `bunny.jsonc has container "${added[0]}", which the app doesn't, and the app has "${unlisted[0]?.name}", which bunny.jsonc doesn't. Deploy would add "${added[0]}" and leave "${unlisted[0]?.name}" running.`,
      `If you renamed it, put the old name back in bunny.jsonc. To add "${added[0]}" alongside it, pass --add-alongside.`,
    );
  }

  const newVolumes = new Map<string, number>();
  const liveVolumes = new Set(app.volumes.map((v) => v.name));
  for (const name of added) {
    for (const v of toml.app.containers[name]?.volumes ?? []) {
      if (liveVolumes.has(v.name)) continue;
      newVolumes.set(v.name, Math.max(v.size, newVolumes.get(v.name) ?? 0));
    }
  }
  if (newVolumes.size > 0) {
    const regions = app.regionSettings.allowedRegionIds.length;
    const max = app.autoScaling?.max ?? 1;
    if (!opts.allowSplitVolumes && (regions > 1 || max > 1)) {
      throw new UserError(
        `Deploy would add volume "${[...newVolumes.keys()][0]}", but app ${app.name} runs in ${regions} region(s) with up to ${max} instance(s).`,
        "Volumes aren't shared: each region and each instance gets its own empty volume. Pass --allow-split-volumes if each copy should keep separate data.",
      );
    }
    await addVolumes(client, appId, newVolumes);
  }
  const takenEndpointNames = new Set(
    app.containerTemplates.flatMap((t) =>
      t.endpoints.map((ep) => ep.displayName),
    ),
  );

  const spin = spinner("Updating container images...");
  spin.start();
  try {
    for (const name of names) {
      const container = toml.app.containers[name];
      if (!container?.image) continue;

      const template = findTemplate(app, name, count);
      if (!template) {
        const { id: _id, ...body } = configToContainerRequest(
          name,
          container,
          registries,
          takenEndpointNames,
        );
        await client.POST("/apps/{appId}/containers", {
          params: { path: { appId } },
          body,
        });
        continue;
      }

      const { imageName, imageNamespace, imageTag, imageDigest } =
        parseImageRef(container.image);
      await client.PATCH("/apps/{appId}/containers/{containerId}", {
        params: { path: { appId, containerId: template.id } },
        body: {
          image: container.image,
          imageName,
          imageNamespace,
          imageTag,
          imageDigest: imageDigest ?? null,
          imageRegistryId: registries?.[name] ?? template.imageRegistryId ?? "",
        },
      });
    }
  } finally {
    spin.stop();
  }
}

/**
 * Fetch the app post-deploy and flatten its endpoints to reachable
 * URLs/IPs. The deploy POST returns nothing useful — the hosts and IPs
 * live on the app's container templates — so we re-read once to surface
 * "where is my app now?".
 */
async function fetchDeployedEndpoints(
  client: ReturnType<typeof createMcClient>,
  appId: string,
): Promise<DeployedEndpointLine[]> {
  const spin = spinner("Fetching endpoints...");
  spin.start();
  const { data: app } = await client.GET("/apps/{appId}", {
    params: { path: { appId } },
  });
  spin.stop();
  return collectDeployedEndpoints(app);
}

/**
 * Print the deployed app's endpoints as a small table. No-op when there
 * are none. Endpoints whose target is still provisioning (anycast IPs
 * assigned moments after deploy) show "provisioning…" with a hint to
 * re-check via `apps endpoints list`.
 */
function printDeployedEndpoints(
  endpoints: DeployedEndpointLine[],
  output: OutputFormat,
): void {
  if (endpoints.length === 0) return;

  logger.log();
  logger.info("Endpoints:");
  const rows = endpoints.map((e) => [
    e.container,
    e.type,
    e.target ?? "provisioning…",
  ]);
  logger.log(formatTable(["Container", "Type", "URL / IP"], rows, output));

  if (endpoints.some((e) => !e.target)) {
    logger.dim(
      "Some endpoints are still provisioning. Run `bunny apps endpoints list` once the app is active.",
    );
  }
}

/**
 * yargs returns `--dockerfile` (bare) as an empty string and `--dockerfile foo`
 * as the path. Normalize to a path-or-undefined.
 */
function normalizeDockerfileFlag(
  value: string | boolean | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  if (value === true || value === "") return DEFAULT_DOCKERFILE;
  if (value === false) return undefined;
  return value;
}

/**
 * Pick the container in `bunny.jsonc` that this deploy targets.
 *
 * - Explicit `--container <name>` → must match a key in `app.containers`.
 * - One container in the manifest → that one, always.
 * - Multiple containers + the user passed `<image>` or `--dockerfile` →
 *   require `--container <name>` so we don't guess which one to swap.
 * - Multiple containers + no image-or-build flag → use the first one
 *   (it doesn't matter — we're only triggering a redeploy of current state).
 */
function resolveTargetContainer(
  toml: BunnyAppConfig,
  opts: { explicit?: string; hasImageOrBuild: boolean },
): [string, ContainerConfig] {
  const entries = Object.entries(toml.app.containers);
  if (entries.length === 0) {
    throw new UserError(
      "bunny.jsonc has no containers configured.",
      "Add a container under `app.containers` and try again.",
    );
  }

  if (opts.explicit) {
    const found = entries.find(
      ([name]) => name.toLowerCase() === opts.explicit?.toLowerCase(),
    );
    if (!found) {
      throw new UserError(
        `Container "${opts.explicit}" not found in bunny.jsonc.`,
        `Available containers: ${entries.map(([n]) => n).join(", ")}`,
      );
    }
    return found;
  }

  if (entries.length > 1 && opts.hasImageOrBuild) {
    throw new UserError(
      "bunny.jsonc has multiple containers — pass --container <name>.",
      `Available containers: ${entries.map(([n]) => n).join(", ")}`,
    );
  }

  const first = entries[0];
  if (!first) {
    // Unreachable — the length === 0 branch above already handled this.
    throw new UserError("bunny.jsonc has no containers configured.");
  }
  return first;
}

/**
 * Pick the registry a single-container deploy should use, in precedence
 * order:
 *
 *   1. `--registry` flag (explicit override)
 *   2. a registry the walkthrough just resolved this run (the draft)
 *   3. the persisted manifest / legacy `bunny.jsonc` field (`fallback`)
 *
 * The draft must beat the manifest fallback. On a first-run deploy the
 * app has no ID yet, so the draft can't be persisted to disk and the
 * manifest lookup returns nothing — without consulting the draft we'd
 * re-prompt for a registry the walkthrough already picked. Mirrors the
 * lookup order in `buildAndPushContainer` (the multi-container path).
 *
 * `fallback` is lazy so its disk read / deprecation warning only fire
 * when neither the flag nor the draft supplies a registry.
 */
function resolveDeployRegistry(
  flag: string | undefined,
  draftRegistry: string | undefined,
  fallback: () => string | undefined,
): string | undefined {
  return flag ?? draftRegistry ?? fallback();
}

type DeployMode =
  | { kind: "build"; dockerfile: string }
  | { kind: "image"; image: string }
  | { kind: "redeploy"; image: string };

function resolveMode(args: {
  positionalImage?: string;
  dockerfileFlag?: string;
  container: ContainerConfig;
}): DeployMode {
  if (args.positionalImage) {
    return { kind: "image", image: args.positionalImage };
  }
  if (args.dockerfileFlag) {
    return { kind: "build", dockerfile: args.dockerfileFlag };
  }
  if (args.container.dockerfile) {
    return { kind: "build", dockerfile: args.container.dockerfile };
  }
  if (args.container.image) {
    return { kind: "redeploy", image: args.container.image };
  }
  throw new UserError(
    "Nothing to deploy.",
    "Pass <image>, use --dockerfile, or set `image`/`dockerfile` on the container in bunny.jsonc.",
  );
}

/**
 * Verify a Dockerfile actually exists on disk before we invoke docker.
 *
 * docker's failure mode is opaque ("open Dockerfile: no such file or
 * directory") and the path it prints isn't the one we passed, which makes
 * it look like a build-context issue when it's really a stale
 * `bunny.jsonc`. Surface a clear UserError naming the exact path the
 * config is pointing at so the fix (edit `bunny.jsonc` or rerun init) is
 * obvious.
 */
function assertDockerfileExists(
  dockerfile: string,
  containerName: string,
): void {
  const abs = isAbsolute(dockerfile)
    ? dockerfile
    : resolve(process.cwd(), dockerfile);
  if (!existsSync(abs)) {
    throw new UserError(
      `Dockerfile not found at ${dockerfile} (resolved to ${abs}) for container "${containerName}".`,
      "Edit `containers." +
        containerName +
        ".dockerfile` in bunny.jsonc to point at the correct file, delete bunny.jsonc and rerun `bunny apps init`, or pass `--dockerfile <path>` explicitly.",
    );
  }
}

function resolveBuildContext(
  dockerfile: string,
  contextOverride: string | undefined,
): string {
  if (contextOverride) {
    return isAbsolute(contextOverride)
      ? contextOverride
      : resolve(process.cwd(), contextOverride);
  }
  const absDockerfile = isAbsolute(dockerfile)
    ? dockerfile
    : resolve(process.cwd(), dockerfile);
  return dirname(absDockerfile);
}

/**
 * Walk every container in bunny.jsonc and prepare it for the create or update request:
 *
 * - `dockerfile`-only entries → build + push to the configured registry,
 *   then write the resulting image ref back onto the container.
 * - Pre-built `image` entries → resolve the matching registry record on
 *   the user's account.
 *
 * The toml is mutated in place and re-saved after every container so
 * partial progress survives a mid-loop failure.
 */
async function prepareContainers(
  client: ReturnType<typeof createMcClient>,
  toml: BunnyAppConfig,
  configPath: string | undefined,
  opts: {
    tag?: string;
    contextOverride?: string;
    /**
     * Manifest's container map at the start of the deploy. Read-only
     * here - registry IDs we already know come from this. New
     * registries discovered in this loop are reported via
     * {@link onRegistryResolved} so the parent can persist eagerly.
     */
    draftContainers: AppManifest["containers"];
    onRegistryResolved: (name: string, registryId: string) => void;
    /** Resolved CLI config — needed to push to the bunny.net registry (API-token auth). */
    cfg: ResolvedConfig;
    verbose?: boolean;
    registryFlag?: string;
    quiet?: boolean;
    noPush?: boolean;
    suggest?: boolean;
  },
): Promise<string[]> {
  const entries = Object.entries(toml.app.containers);

  // One shared tag for every build in this deploy so co-deployed images
  // are easy to correlate later (same git sha + timestamp).
  const sharedTag = opts.tag ?? (await generateTag());

  const built: string[] = [];
  for (const [name, container] of entries) {
    if (container.dockerfile) {
      const imageRef = await buildAndPushContainer(
        client,
        toml,
        name,
        container,
        {
          tag: sharedTag,
          contextOverride: opts.contextOverride,
          draftContainers: opts.draftContainers,
          onRegistryResolved: opts.onRegistryResolved,
          cfg: opts.cfg,
          verbose: opts.verbose,
          registryFlag: opts.registryFlag,
          quiet: opts.quiet,
          noPush: opts.noPush,
          suggest: opts.suggest,
        },
      );
      built.push(imageRef);
    } else if (opts.noPush && container.image) {
      continue;
    } else if (container.image) {
      await resolveRegistryForPrebuiltImage(client, name, container, {
        onRegistryResolved: opts.onRegistryResolved,
      });
    } else {
      throw new UserError(
        `Container "${name}" has neither \`image\` nor \`dockerfile\`.`,
        "Add one or the other in bunny.jsonc.",
      );
    }
    if (configExists(configPath)) saveConfig(toml, configPath);
  }
  return built;
}

async function buildAndPushContainer(
  client: ReturnType<typeof createMcClient>,
  toml: BunnyAppConfig,
  name: string,
  container: ContainerConfig,
  opts: {
    tag: string;
    contextOverride?: string;
    draftContainers: AppManifest["containers"];
    onRegistryResolved: (name: string, registryId: string) => void;
    cfg: ResolvedConfig;
    verbose?: boolean;
    registryFlag?: string;
    quiet?: boolean;
    noPush?: boolean;
    suggest?: boolean;
  },
): Promise<string> {
  if (!container.dockerfile)
    throw new UserError(`Container "${name}" has no \`dockerfile\`.`);

  assertDockerfileExists(container.dockerfile, name);

  let freshCreds: ResolvedRegistry["freshCredentials"];
  let registryId =
    opts.registryFlag ??
    opts.draftContainers[name]?.registry ??
    resolveContainerRegistry(name, container);

  if (!registryId) {
    logger.info(`Pick a registry to push the "${name}" image to.`);
    const resolved = await promptRegistry(client);
    if (!resolved) {
      throw new UserError(
        `A registry is required to build and push "${name}".`,
      );
    }
    registryId = resolved.id;
    freshCreds = resolved.freshCredentials;
  }

  opts.onRegistryResolved(name, registryId);

  const regSpin = spinner(`Fetching registry for ${name}...`);
  regSpin.start();
  const reg = await getRegistry(client, registryId);
  regSpin.stop();

  if (!reg?.hostName) {
    throw new UserError(
      `Registry ${registryId} not found or has no hostname.`,
      "Use `bunny apps registries list` to check your registries.",
    );
  }

  // The bunny.net registry record is public (no userName): repositories
  // are namespaced by account id and pushes authenticate with the API token.
  const isBunnyRegistry = registryId === BUNNY_REGISTRY_ID;
  const namespace = isBunnyRegistry
    ? await fetchRegistryNamespace(opts.cfg, opts.verbose)
    : reg.userName;

  const imageRef = buildImageRef(
    reg.hostName,
    namespace,
    `${toml.app.name}-${name}`,
    opts.tag,
  );
  const buildCwd = resolveBuildContext(
    container.dockerfile,
    container.context ?? opts.contextOverride,
  );

  logger.info(`Building ${imageRef}...`);
  await buildImage(container.dockerfile, imageRef, buildCwd, {
    quiet: opts.quiet,
  });

  if (opts.noPush) {
    logger.success(`Image built: ${imageRef}`);
    return imageRef;
  }

  if (isBunnyRegistry) {
    if (!opts.cfg.apiKey) {
      throw new UserError(
        "Not logged in.",
        'Run "bunny login" to authenticate.',
      );
    }
    const loginSpin = spinner(`Logging in to ${reg.hostName}...`);
    loginSpin.start();
    try {
      await dockerLogin(reg.hostName, REGISTRY_USERNAME, opts.cfg.apiKey);
    } finally {
      loginSpin.stop();
    }
  } else if (freshCreds) {
    const loginSpin = spinner(`Logging in to ${reg.hostName}...`);
    loginSpin.start();
    try {
      await dockerLogin(reg.hostName, freshCreds.userName, freshCreds.password);
      loginSpin.stop();
    } catch (err) {
      loginSpin.stop();
      throw err;
    }
  } else {
    await ensureRegistryLogin(
      reg.hostName,
      reg.userName,
      isInteractive(opts.quiet ? "json" : undefined),
    );
  }

  logger.info(`Pushing ${imageRef}...`);
  await pushImage(imageRef, { quiet: opts.quiet });

  // In-memory only - `saveConfig` strips this for dockerfile containers.
  // Needed here so `configToAddRequest` picks up the ref on first create.
  container.image = imageRef;

  if (!opts.suggest) return imageRef;
  await applyPostPushSuggestions(
    client,
    registryId,
    imageRef,
    { kind: "build", dockerfile: container.dockerfile },
    {
      targetContainer: container,
      dockerfilePath: container.dockerfile,
      interactive: isInteractive(opts.quiet ? "json" : undefined),
    },
  );
  return imageRef;
}

async function resolveRegistryForPrebuiltImage(
  client: ReturnType<typeof createMcClient>,
  name: string,
  container: ContainerConfig,
  opts: { onRegistryResolved: (name: string, registryId: string) => void },
): Promise<void> {
  if (!container.image) return;

  // Always resolve by hostname for pre-built images: any registry
  // currently associated with this container may be the user's push
  // registry, which is wrong for images from other hosts (Docker Hub, etc.).
  const resolved = await resolveRegistryForImage(client, container.image);
  if (!resolved) {
    throw new UserError(
      `A registry is required for "${name}" (image: ${container.image}).`,
      "bunny.net needs a registry record for the image hostname so it can pull the image.",
    );
  }
  opts.onRegistryResolved(name, resolved.id);
}
