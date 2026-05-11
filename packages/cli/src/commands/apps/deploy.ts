import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { createMcClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/magic-containers.d.ts";
import prompts from "prompts";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import {
  type BunnyAppConfig,
  type ContainerConfig,
  CURRENT_VERSION,
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
  generateTag,
  getConfigSuggestions,
  type McClient,
  promptRegistry,
  pushImage,
  type ResolvedRegistry,
  resolveRegistryForImage,
} from "./docker.ts";

type EndpointRequest = components["schemas"]["EndpointRequest"];

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
        describe: "Bunny registry ID to push to (overrides bunny.jsonc)",
      })
      .option("container", {
        type: "string",
        describe:
          "Target container by name (required when bunny.jsonc has multiple containers)",
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

    if (positionalImage && dockerfileFlag) {
      throw new UserError(
        "Cannot use both <image> and --dockerfile at the same time.",
        "Pass an image to deploy a pre-built ref, or --dockerfile to build locally.",
      );
    }

    const cfg = resolveConfig(profile, apiKey);
    const client = createMcClient(clientOptions(cfg, verbose));

    let toml: BunnyAppConfig;
    if (!configExists()) {
      toml = await firstRunWalkthrough(client, {
        positionalImage,
        dockerfileFlag,
        contextFlag: args.context,
        registryFlag: args.registry,
      });
    } else {
      toml = loadConfig();
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
        saveConfig(toml);
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
          "Bunny needs a registry record for the image hostname so it can pull the image.",
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
        body: configToAddRequest(toml),
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
        body: configToPatchRequest(toml, existingApp),
      });
      pushSpin.stop();
    }

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
        JSON.stringify({ id: appId, deployed: true, image: deployImage }),
      );
      return;
    }

    logger.success("App deployed.");
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

interface WalkthroughInput {
  positionalImage?: string;
  dockerfileFlag?: string;
  contextFlag?: string;
  registryFlag?: string;
}

async function firstRunWalkthrough(
  client: McClient,
  input: WalkthroughInput,
): Promise<BunnyAppConfig> {
  logger.info("No bunny.jsonc found — setting up this app.");

  // Decide build vs deploy if neither flag was passed.
  let imageRef: string | undefined = input.positionalImage;
  let dockerfilePath: string | undefined = input.dockerfileFlag;

  if (!imageRef && !dockerfilePath) {
    const hasDockerfile = existsSync(join(process.cwd(), DEFAULT_DOCKERFILE));
    const { value } = await prompts({
      type: "select",
      name: "value",
      message: "How do you want to deploy?",
      choices: [
        ...(hasDockerfile
          ? [
              {
                title: "Build from ./Dockerfile",
                value: "dockerfile",
              },
            ]
          : []),
        { title: "Deploy a pre-built image", value: "image" },
      ],
    });
    if (!value) throw new UserError("Setup cancelled.");
    if (value === "dockerfile") {
      dockerfilePath = DEFAULT_DOCKERFILE;
    } else {
      const { value: ref } = await prompts({
        type: "text",
        name: "value",
        message: "Image ref (e.g. ghcr.io/me/api:v1):",
      });
      if (!ref) throw new UserError("Image ref is required.");
      imageRef = ref;
    }
  }

  const mode: "build" | "image" = dockerfilePath ? "build" : "image";

  let registry: ResolvedRegistry | null;
  if (input.registryFlag) {
    registry = { id: input.registryFlag };
  } else if (mode === "image" && imageRef) {
    registry = await resolveRegistryForImage(client, imageRef);
  } else {
    logger.info("Pick a registry to push your image to.");
    registry = await promptRegistry(client);
  }
  if (!registry) throw new UserError("A registry is required.");

  let suggestions: Awaited<ReturnType<typeof getConfigSuggestions>> | null =
    null;
  if (mode === "image" && imageRef) {
    const parsed = parseImageRef(imageRef);
    suggestions = await getConfigSuggestions(client, registry.id, parsed);
    if (suggestions?.instructions) {
      logger.log();
      logger.dim(suggestions.instructions);
      logger.log();
    }
  }

  const defaultName =
    suggestions?.appName?.trim() || basename(resolve(process.cwd()));
  const { value: name } = await prompts({
    type: "text",
    name: "value",
    message: "App name:",
    initial: defaultName,
  });
  if (!name) throw new UserError("App name is required.");

  const regionsSpin = spinner("Fetching regions...");
  regionsSpin.start();
  const { data: regionsResult } = await client.GET("/regions");
  regionsSpin.stop();

  const regionsWithCapacity = (regionsResult?.items ?? []).filter(
    (r): r is typeof r & { id: string } =>
      r.hasCapacity === true && typeof r.id === "string",
  );

  if (regionsWithCapacity.length === 0) {
    throw new UserError("No regions with capacity are available right now.");
  }

  const { value: selectedRegions } = await prompts({
    type: "multiselect",
    name: "value",
    message: "Select regions:",
    choices: regionsWithCapacity.map((r) => ({
      title: `${r.name} (${r.id})`,
      value: r.id,
    })),
    min: 1,
  });

  const regions: string[] = selectedRegions ?? [];
  if (regions.length === 0) {
    throw new UserError("At least one region must be selected.");
  }

  const container: ContainerConfig = {
    registry: registry.id,
  };

  if (mode === "build" && dockerfilePath) {
    container.dockerfile = dockerfilePath;
    if (input.contextFlag) container.context = input.contextFlag;
  }
  if (imageRef) {
    container.image = imageRef;
  }

  // Apply suggested endpoints.
  if (suggestions?.endpointSuggestions?.length) {
    const accepted = await confirmEndpointSuggestions(
      suggestions.endpointSuggestions,
    );
    if (accepted.length > 0) {
      container.endpoints = accepted.map(endpointRequestToConfig);
    }
  }

  // Prompt for suggested env vars (required first; offer optional ones).
  if (suggestions?.environmentVariablesSuggestions?.length) {
    const env = await promptSuggestedEnv(
      suggestions.environmentVariablesSuggestions,
    );
    if (Object.keys(env).length > 0) {
      container.env = env;
    }
  }

  const toml: BunnyAppConfig = {
    version: CURRENT_VERSION,
    app: {
      name,
      scaling: { min: 1, max: 1 },
      regions,
      containers: { [name]: container },
    },
  };

  saveConfig(toml);
  logger.success("Wrote bunny.jsonc.");
  return toml;
}

async function confirmEndpointSuggestions(
  endpoints: EndpointRequest[],
): Promise<EndpointRequest[]> {
  const accepted: EndpointRequest[] = [];
  for (const ep of endpoints) {
    const label = describeEndpoint(ep);
    const { value } = await prompts({
      type: "confirm",
      name: "value",
      message: `Add suggested endpoint: ${label}?`,
      initial: true,
    });
    if (value) accepted.push(ep);
  }
  return accepted;
}

function describeEndpoint(ep: EndpointRequest): string {
  if (ep.cdn) {
    const ports = ep.cdn.portMappings
      ?.map((p) => `${p.exposedPort}→${p.containerPort}`)
      .join(", ");
    return `CDN (${ports ?? "default port"})${ep.cdn.isSslEnabled ? " + SSL" : ""}`;
  }
  if (ep.anycast) {
    const ports = ep.anycast.portMappings
      .map((p) => `${p.exposedPort}→${p.containerPort}`)
      .join(", ");
    return `Anycast (${ports})`;
  }
  return ep.displayName ?? "endpoint";
}

function endpointRequestToConfig(
  ep: EndpointRequest,
): NonNullable<ContainerConfig["endpoints"]>[number] {
  if (ep.cdn) {
    return {
      type: "cdn",
      ssl: ep.cdn.isSslEnabled,
      ports:
        ep.cdn.portMappings?.map((p) => ({
          public: p.exposedPort ?? p.containerPort,
          container: p.containerPort,
        })) ?? [],
    };
  }
  if (ep.anycast) {
    return {
      type: "anycast",
      ports: ep.anycast.portMappings.map((p) => ({
        public: p.exposedPort ?? p.containerPort,
        container: p.containerPort,
      })),
    };
  }
  return { type: "cdn" };
}

async function promptSuggestedEnv(
  suggestions: components["schemas"]["EnvironmentVariableSuggestion"][],
): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  const required = suggestions.filter((s) => s.required);
  const optional = suggestions.filter((s) => !s.required);

  for (const item of required) {
    if (!item.name) continue;
    const { value } = await prompts({
      type: "text",
      name: "value",
      message: `${item.name}${item.description ? ` — ${item.description}` : ""}:`,
      initial: item.defaultValue ?? "",
    });
    if (value !== undefined && value !== "") env[item.name] = String(value);
  }

  if (optional.length > 0) {
    const { value: confirm } = await prompts({
      type: "confirm",
      name: "value",
      message: `Configure ${optional.length} optional env var${optional.length === 1 ? "" : "s"} now?`,
      initial: false,
    });
    if (confirm) {
      for (const item of optional) {
        if (!item.name) continue;
        const { value } = await prompts({
          type: "text",
          name: "value",
          message: `${item.name}${item.description ? ` — ${item.description}` : ""}:`,
          initial: item.defaultValue ?? "",
        });
        if (value !== undefined && value !== "") env[item.name] = String(value);
      }
    }
  }

  return env;
}
