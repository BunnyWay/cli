import { dirname, isAbsolute, resolve } from "node:path";
import type { RegistryMap } from "@bunny.net/app-config";
import { createMcClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest, saveManifest } from "../../core/manifest.ts";
import { spinner } from "../../core/ui.ts";
import {
  type BunnyAppConfig,
  type ContainerConfig,
  configExists,
  configToAddRequest,
  configToPatchRequest,
  loadConfig,
  parseImageRef,
  resolveContainerRegistry,
  saveConfig,
} from "./config.ts";
import { APP_MANIFEST, type AppManifest } from "./constants.ts";

/**
 * Extract the per-container registry IDs we have so far into the
 * registry-override map expected by `configToAddRequest` /
 * `configToPatchRequest`. Empty entries are omitted so they don't
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
  opts: { targetContainer: ContainerConfig; dockerfilePath: string },
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
  if (newEndpoints.length > 0) {
    const accepted = await confirmEndpointSuggestions(newEndpoints);
    if (accepted.length > 0) {
      opts.targetContainer.endpoints = [
        ...(opts.targetContainer.endpoints ?? []),
        ...accepted.map(endpointRequestToConfig),
      ];
    }
  }

  const newEnvs = filterNewEnvSuggestions(envSuggestions, opts.targetContainer);
  if (newEnvs.length > 0) {
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
  buildImage,
  buildImageRef,
  dockerLogin,
  ensureDockerAvailable,
  ensureRegistryLogin,
  generateTag,
  getConfigSuggestions,
  promptRegistry,
  pushImage,
  type ResolvedRegistry,
  readDockerfileExposedPorts,
  resolveRegistryForImage,
} from "./docker.ts";
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
  "no-push"?: boolean;
}

export const appsDeployCommand = defineCommand<DeployArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 apps deploy ghcr.io/me/api:v1.2", "Deploy a pre-built image"],
    ["$0 apps deploy --dockerfile", "Build ./Dockerfile and deploy"],
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
        describe: "bunny.net registry ID to push to (overrides bunny.jsonc)",
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
      .option("no-push", {
        type: "boolean",
        describe: "Build only — skip push and deploy",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const positionalImage = args.image;
    const dockerfileFlag = normalizeDockerfileFlag(args.dockerfile);
    const noPush = args["no-push"] === true;
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

    const cfg = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(cfg, verbose));

    let toml: BunnyAppConfig;
    /** Registries the walkthrough resolved, to seed the manifest draft below. */
    let walkthroughRegistries: Record<string, string> = {};
    if (!configExists(configPath)) {
      const result = await runWalkthrough(client, {
        positionalImage,
        dockerfileFlag,
        contextFlag: args.context,
        registryFlag: args.registry,
        portOverride: args.port,
        commandOverride: args.command,
        nameOverride: args.name,
        configPath,
        dryRun,
      });
      toml = result.config;
      walkthroughRegistries = result.registries;
    } else {
      toml = loadConfig(configPath);
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

    // First-time deploy of a multi-container app (e.g. compose import).
    // The single-container flow below can only build/push one image, so
    // for multi-container creates we iterate every container, build any
    // with a `dockerfile`, resolve a registry for any with a pre-built
    // `image`, then create the app in one POST.
    const containerEntries = Object.entries(toml.app.containers);
    if (
      !draft.id &&
      containerEntries.length > 1 &&
      !positionalImage &&
      !dockerfileFlag &&
      !args.container
    ) {
      await prepareContainersForCreate(client, toml, configPath, {
        tag: args.tag,
        contextOverride: args.context,
        draftContainers: draft.containers,
        onRegistryResolved: setContainerRegistry,
      });

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

      draft.id = result.id;
      persistDraft();
      logger.success(`App "${toml.app.name}" created (${result.id}).`);

      // POST /apps returns only the new app ID. Fetch the full app to
      // capture container template IDs so subsequent commands can target
      // each container without re-fetching.
      const fetchSpin = spinner("Recording container IDs...");
      fetchSpin.start();
      const { data: createdApp } = await client.GET("/apps/{appId}", {
        params: { path: { appId: result.id } },
      });
      fetchSpin.stop();
      for (const ct of createdApp?.containerTemplates ?? []) {
        setContainerTemplateId(ct.name, ct.id);
      }

      const deploySpin = spinner("Deploying...");
      deploySpin.start();
      await client.POST("/apps/{appId}/deploy", {
        params: { path: { appId: result.id } },
      });
      deploySpin.stop();

      if (output === "json") {
        logger.log(JSON.stringify({ id: result.id, deployed: true }));
        return;
      }

      logger.success("App deployed.");
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
    let registryId: string | undefined =
      args.registry ?? resolveContainerRegistry(targetName, targetContainer);
    let freshCreds: ResolvedRegistry["freshCredentials"];

    if (mode.kind === "build") {
      await ensureDockerAvailable();

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
        setContainerRegistry(targetName, registryId);
      }

      const regSpin = spinner("Fetching registry...");
      regSpin.start();
      const { data: reg } = await client.GET("/registries/{registryId}", {
        params: { path: { registryId: Number(registryId) } },
      });
      regSpin.stop();

      if (!reg?.hostName) {
        throw new UserError(
          `Registry ${registryId} not found or has no hostname.`,
          "Use `bunny registries list` to check your registries.",
        );
      }

      const tag = args.tag ?? (await generateTag());
      const imageRef = buildImageRef(
        reg.hostName,
        reg.userName,
        toml.app.name,
        tag,
      );
      const buildCwd = resolveBuildContext(mode.dockerfile, args.context);

      logger.info(`Building ${imageRef}...`);
      await buildImage(mode.dockerfile, imageRef, buildCwd);

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

      if (freshCreds && reg.hostName) {
        const loginSpin = spinner(`Logging in to ${reg.hostName}...`);
        loginSpin.start();
        try {
          await dockerLogin(
            reg.hostName,
            freshCreds.userName,
            freshCreds.password,
          );
          loginSpin.stop();
        } catch (err) {
          loginSpin.stop();
          throw err;
        }
      } else if (reg.hostName) {
        // No just-entered credentials, so make sure docker is logged in
        // before we attempt the push, prompting if not.
        await ensureRegistryLogin(reg.hostName);
      }

      logger.info(`Pushing ${imageRef}...`);
      await pushImage(imageRef);

      deployImage = imageRef;
      // In-memory only - `saveConfig` strips `image` for dockerfile
      // containers via `stripTransientFields`. The MC API is the source
      // of truth for what's deployed; `bunny.jsonc` stores intent only.
      // The mutation is still needed for `configToAddRequest` /
      // `configToPatchRequest` to read the ref in the same deploy run.
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
      if (registryId) {
        await applyPostPushSuggestions(client, registryId, imageRef, mode, {
          targetContainer,
          dockerfilePath: mode.dockerfile,
        });
      }

      saveConfig(toml, configPath);
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
      saveConfig(toml, configPath);
    }

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
      const pushSpin = spinner("Pushing config...");
      pushSpin.start();

      const { data: existingApp } = await client.GET("/apps/{appId}", {
        params: { path: { appId } },
      });

      if (!existingApp) {
        pushSpin.stop();
        throw new UserError(`App ${appId} not found.`);
      }

      await client.PATCH("/apps/{appId}", {
        params: { path: { appId } },
        body: configToPatchRequest(
          resolveContainerEnv(toml, dotenvPath),
          existingApp,
          draftRegistries(draft.containers),
        ),
      });
      pushSpin.stop();
    }

    // Captured pre-deploy so we can surface a rollback hint at the end.
    let previousImage: string | undefined;

    if (deployImage) {
      const fetchSpin = spinner("Fetching app...");
      fetchSpin.start();
      const { data: app } = await client.GET("/apps/{appId}", {
        params: { path: { appId } },
      });
      fetchSpin.stop();

      // Find the remote container template matching our target by name —
      // falls back to the primary if there's only one.
      const templates = app?.containerTemplates ?? [];
      const match =
        templates.find(
          (t) => t.name.toLowerCase() === targetName.toLowerCase(),
        ) ?? (templates.length === 1 ? templates[0] : undefined);

      if (!match) {
        throw new UserError(
          `Container "${targetName}" not found on the remote app.`,
          `Remote containers: ${templates.map((t) => t.name).join(", ") || "(none)"}`,
        );
      }

      previousImage = match.image ?? undefined;

      const containerId = match.id;
      // Cache the resolved template ID in the manifest so the next
      // deploy/restart/env-push doesn't have to re-resolve by name.
      setContainerTemplateId(targetName, containerId);
      const { imageName, imageNamespace, imageTag } =
        parseImageRef(deployImage);

      const updateSpin = spinner("Updating container image...");
      updateSpin.start();
      await client.PATCH("/apps/{appId}/containers/{containerId}", {
        params: { path: { appId, containerId } },
        body: {
          image: deployImage,
          imageName,
          imageNamespace,
          imageTag,
          imageRegistryId: registryId ?? "",
        },
      });
      updateSpin.stop();
      logger.success(`Image updated to ${deployImage}.`);
    }

    const deploySpin = spinner("Deploying...");
    deploySpin.start();
    await client.POST("/apps/{appId}/deploy", {
      params: { path: { appId } },
    });
    deploySpin.stop();

    if (output === "json") {
      logger.log(
        JSON.stringify({
          id: appId,
          deployed: true,
          image: deployImage,
          previousImage,
        }),
      );
      return;
    }

    logger.success("App deployed.");

    // Rollback hint, only meaningful when there was a previous image
    // and we just replaced it with a different one.
    if (previousImage && previousImage !== deployImage) {
      logger.log();
      logger.dim(`Previous image: ${previousImage}`);
      logger.dim(`To rollback:    bunny apps deploy ${previousImage}`);
    }
  },
});

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
 * Walk every container in bunny.jsonc and prepare it for `POST /apps`:
 *
 * - `dockerfile`-only entries → build + push to the configured registry,
 *   then write the resulting image ref back onto the container.
 * - Pre-built `image` entries → resolve the matching registry record on
 *   the user's account (compose import assigns the user's push registry
 *   to every container by default, which is wrong for public images like
 *   `postgres:17-alpine`).
 *
 * The toml is mutated in place and re-saved after every container so
 * partial progress survives a mid-loop failure.
 */
async function prepareContainersForCreate(
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
  },
): Promise<void> {
  const entries = Object.entries(toml.app.containers);
  const hasAnyBuild = entries.some(([, c]) => c.dockerfile);
  if (hasAnyBuild) {
    await ensureDockerAvailable();
  }

  // One shared tag for every build in this deploy so co-deployed images
  // are easy to correlate later (same git sha + timestamp).
  const sharedTag = opts.tag ?? (await generateTag());

  for (const [name, container] of entries) {
    if (container.dockerfile) {
      await buildAndPushContainer(client, toml, name, container, {
        tag: sharedTag,
        contextOverride: opts.contextOverride,
        draftContainers: opts.draftContainers,
        onRegistryResolved: opts.onRegistryResolved,
      });
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
    saveConfig(toml, configPath);
  }
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
  },
): Promise<void> {
  if (!container.dockerfile) return;

  let freshCreds: ResolvedRegistry["freshCredentials"];
  let registryId =
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
    opts.onRegistryResolved(name, registryId);
  }

  const regSpin = spinner(`Fetching registry for ${name}...`);
  regSpin.start();
  const { data: reg } = await client.GET("/registries/{registryId}", {
    params: { path: { registryId: Number(registryId) } },
  });
  regSpin.stop();

  if (!reg?.hostName) {
    throw new UserError(
      `Registry ${registryId} not found or has no hostname.`,
      "Use `bunny registries list` to check your registries.",
    );
  }

  const imageRef = buildImageRef(
    reg.hostName,
    reg.userName,
    `${toml.app.name}-${name}`,
    opts.tag,
  );
  const buildCwd = resolveBuildContext(
    container.dockerfile,
    container.context ?? opts.contextOverride,
  );

  logger.info(`Building ${imageRef}...`);
  await buildImage(container.dockerfile, imageRef, buildCwd);

  if (freshCreds && reg.hostName) {
    const loginSpin = spinner(`Logging in to ${reg.hostName}...`);
    loginSpin.start();
    try {
      await dockerLogin(reg.hostName, freshCreds.userName, freshCreds.password);
      loginSpin.stop();
    } catch (err) {
      loginSpin.stop();
      throw err;
    }
  } else if (reg.hostName) {
    await ensureRegistryLogin(reg.hostName);
  }

  logger.info(`Pushing ${imageRef}...`);
  await pushImage(imageRef);

  // In-memory only - `saveConfig` strips this for dockerfile containers.
  // Needed here so `configToAddRequest` picks up the ref on first create.
  container.image = imageRef;

  await applyPostPushSuggestions(
    client,
    registryId,
    imageRef,
    { kind: "build", dockerfile: container.dockerfile },
    { targetContainer: container, dockerfilePath: container.dockerfile },
  );
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
