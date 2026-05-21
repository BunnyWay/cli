import { dirname, isAbsolute, resolve } from "node:path";
import { createMcClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import {
  type BunnyAppConfig,
  type ContainerConfig,
  configExists,
  configToAddRequest,
  configToPatchRequest,
  loadConfig,
  parseImageRef,
  saveConfig,
} from "./config.ts";
import {
  buildImage,
  dockerLogin,
  ensureDockerAvailable,
  ensureRegistryLogin,
  generateTag,
  promptRegistry,
  pushImage,
  type ResolvedRegistry,
  resolveRegistryForImage,
} from "./docker.ts";
import { resolveContainerEnv } from "./env/resolve.ts";
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
    if (!configExists(configPath)) {
      toml = await runWalkthrough(client, {
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
    } else {
      toml = loadConfig(configPath);
    }

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
      !toml.app.id &&
      containerEntries.length > 1 &&
      !positionalImage &&
      !dockerfileFlag &&
      !args.container
    ) {
      await prepareContainersForCreate(client, toml, configPath, {
        tag: args.tag,
        contextOverride: args.context,
      });

      const createSpin = spinner("Creating app...");
      createSpin.start();
      const { data: result } = await client.POST("/apps", {
        body: configToAddRequest(resolveContainerEnv(toml, dotenvPath)),
      });
      createSpin.stop();

      if (!result?.id) {
        throw new UserError("Failed to create app — no ID returned.");
      }

      toml.app.id = result.id;
      saveConfig(toml, configPath);
      logger.success(`App "${toml.app.name}" created (${result.id}).`);

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
      args.registry ?? targetContainer.registry;
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
        targetContainer.registry = registryId;
        saveConfig(toml, configPath);
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
      const imageRef = `${reg.hostName}/${toml.app.name}:${tag}`;
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
      targetContainer.image = imageRef;
      // Persist dockerfile/context if they came from flags so the manifest stays the source of truth.
      if (!targetContainer.dockerfile) {
        targetContainer.dockerfile = mode.dockerfile;
      }
      if (args.context && !targetContainer.context) {
        targetContainer.context = args.context;
      }
      saveConfig(toml);
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
      targetContainer.image = mode.image;
      targetContainer.registry = registryId;
      saveConfig(toml);
    }

    let appId = toml.app.id;
    if (!appId) {
      const createSpin = spinner("Creating app...");
      createSpin.start();

      const { data: result } = await client.POST("/apps", {
        body: configToAddRequest(resolveContainerEnv(toml, dotenvPath)),
      });
      createSpin.stop();

      if (!result?.id) {
        throw new UserError("Failed to create app — no ID returned.");
      }

      appId = result.id;
      toml.app.id = appId;
      saveConfig(toml);

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
  opts: { tag?: string; contextOverride?: string },
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
      });
    } else if (container.image) {
      await resolveContainerRegistry(client, name, container);
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
  opts: { tag: string; contextOverride?: string },
): Promise<void> {
  if (!container.dockerfile) return;

  let freshCreds: ResolvedRegistry["freshCredentials"];
  if (!container.registry) {
    logger.info(`Pick a registry to push the "${name}" image to.`);
    const resolved = await promptRegistry(client);
    if (!resolved) {
      throw new UserError(
        `A registry is required to build and push "${name}".`,
      );
    }
    container.registry = resolved.id;
    freshCreds = resolved.freshCredentials;
  }

  const regSpin = spinner(`Fetching registry for ${name}...`);
  regSpin.start();
  const { data: reg } = await client.GET("/registries/{registryId}", {
    params: { path: { registryId: Number(container.registry) } },
  });
  regSpin.stop();

  if (!reg?.hostName) {
    throw new UserError(
      `Registry ${container.registry} not found or has no hostname.`,
      "Use `bunny registries list` to check your registries.",
    );
  }

  const imageRef = `${reg.hostName}/${toml.app.name}-${name}:${opts.tag}`;
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

  container.image = imageRef;
}

async function resolveContainerRegistry(
  client: ReturnType<typeof createMcClient>,
  name: string,
  container: ContainerConfig,
): Promise<void> {
  if (!container.image) return;

  // Always resolve by hostname for pre-built images: the registry
  // currently set on the container may be the user's push registry,
  // which is wrong for images from other hosts (Docker Hub, etc.).
  const resolved = await resolveRegistryForImage(client, container.image);
  if (!resolved) {
    throw new UserError(
      `A registry is required for "${name}" (image: ${container.image}).`,
      "bunny.net needs a registry record for the image hostname so it can pull the image.",
    );
  }
  container.registry = resolved.id;
}
