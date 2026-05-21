import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import prompts from "prompts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { spinner } from "../../core/ui.ts";
import {
  composeToConfig,
  findComposeFile,
  loadComposeFile,
} from "./compose/index.ts";
import {
  type BunnyAppConfig,
  type ContainerConfig,
  CURRENT_VERSION,
  parseImageRef,
  saveConfig,
} from "./config.ts";
import {
  getConfigSuggestions,
  type McClient,
  promptRegistry,
  type ResolvedRegistry,
  readDockerfileExposedPorts,
  resolveRegistryForImage,
} from "./docker.ts";
import {
  confirmEndpointSuggestions,
  endpointRequestToConfig,
  promptSuggestedEnv,
} from "./suggestions.ts";

const DEFAULT_DOCKERFILE = "Dockerfile";

/**
 * Inputs to the shared walkthrough. Flags passed from `apps deploy`,
 * `apps init`, etc. land here.
 */
export interface WalkthroughInput {
  /** Pre-built image ref the user passed positionally. */
  positionalImage?: string;
  /** Dockerfile path the user passed via --dockerfile. */
  dockerfileFlag?: string;
  /** Build context the user passed via --context. */
  contextFlag?: string;
  /** Registry ID the user passed via --registry. */
  registryFlag?: string;
  /** Port override (--port). Retargets any endpoints written to bunny.jsonc. */
  portOverride?: number;
  /** Container CMD override (--command). Stored as container.command. */
  commandOverride?: string;
  /** App name (--name). When set, skips the interactive name prompt. */
  nameOverride?: string;
  /**
   * If true, skip every write side-effect: don't generate files to
   * disk, don't save bunny.jsonc. The walkthrough still prompts and
   * still returns a valid config; the caller decides what to do
   * with it.
   */
  dryRun?: boolean;
  /**
   * Absolute path the resulting config should be written to. When
   * unset, the walkthrough writes `./bunny.jsonc` in cwd (current
   * default). Set this when `--config <path>` is used so the persisted
   * config lands in the caller's chosen file.
   */
  configPath?: string;
}

/**
 * Result of the walkthrough.
 *
 * `config` is the new `bunny.jsonc` (intent only). `registries` is the
 * per-container registry mapping the user picked or that we inferred -
 * it doesn't go in `bunny.jsonc` (account-scoped), but the deploy flow
 * that immediately runs after the walkthrough needs it to call the API.
 * Whichever command runs the walkthrough is responsible for persisting
 * these into `.bunny/app.json` once it has the app ID to attach them
 * to. `apps init` just discards them - the next deploy will re-prompt
 * or re-resolve.
 */
export interface WalkthroughResult {
  config: BunnyAppConfig;
  registries: Record<string, string>;
}

/**
 * Run the new-app walkthrough and return the resulting `bunny.jsonc` shape.
 *
 * Used by both `apps deploy` (which then proceeds to create + build +
 * deploy) and `apps init` (which stops at "config written"). Sharing the
 * function means both commands generate identical configs.
 *
 * Side effects (saving bunny.jsonc) are skipped when `input.dryRun` is true.
 */
export async function runWalkthrough(
  client: McClient,
  input: WalkthroughInput,
): Promise<WalkthroughResult> {
  logger.info("No bunny.jsonc found. Setting up this app.");

  let imageRef: string | undefined = input.positionalImage;
  let dockerfilePath: string | undefined = input.dockerfileFlag;

  if (!imageRef && !dockerfilePath) {
    const composeFile = findComposeFile(process.cwd());
    const hasDockerfile = existsSync(join(process.cwd(), DEFAULT_DOCKERFILE));

    const composeServicesCount = composeFile
      ? Object.keys(loadComposeFile(composeFile).services).length
      : 0;

    const { value } = await prompts({
      type: "select",
      name: "value",
      message: "How do you want to deploy?",
      choices: [
        ...(composeFile
          ? [
              {
                title: `Import ${composeServicesCount} service${composeServicesCount === 1 ? "" : "s"} from ${basename(composeFile)}`,
                value: "compose",
              },
            ]
          : []),
        ...(hasDockerfile
          ? [{ title: "Build from ./Dockerfile", value: "dockerfile" }]
          : []),
        { title: "Deploy a pre-built image", value: "image" },
      ],
    });
    if (!value) throw new UserError("Setup cancelled.");

    if (value === "compose" && composeFile) {
      return runComposeImport(client, composeFile, input);
    }

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
  } else if (mode === "build" && dockerfilePath) {
    // Read EXPOSE directives from the Dockerfile to seed endpoint
    // suggestions. bunny's getConfigSuggestions only works for pre-built
    // images, so build mode needs a local equivalent - otherwise users
    // end up with an app that has no way to reach the container.
    const dockerfileAbs = resolve(process.cwd(), dockerfilePath);
    const exposedPorts = await readDockerfileExposedPorts(dockerfileAbs);
    if (exposedPorts.length > 0) {
      suggestions = {
        endpointSuggestions: exposedPorts.map((port) => ({
          displayName: "cdn",
          cdn: {
            isSslEnabled: true,
            portMappings: [{ exposedPort: 443, containerPort: port }],
          },
        })),
      };
    }
  }

  const name =
    input.nameOverride ??
    (await promptAppName(suggestions?.appName ?? undefined));

  const regions = await pickRegions(client);

  // `registry` is account-scoped - it lives in the manifest, not the
  // shared config. We hold it in memory long enough for the deploy run
  // that immediately follows this walkthrough, then `saveConfig` strips
  // it from disk via `stripTransientFields`.
  const container: ContainerConfig = {};

  if (mode === "build" && dockerfilePath) {
    container.dockerfile = dockerfilePath;
    if (input.contextFlag) container.context = input.contextFlag;
  }
  if (imageRef) {
    container.image = imageRef;
  }

  if (suggestions?.endpointSuggestions?.length) {
    const accepted = await confirmEndpointSuggestions(
      suggestions.endpointSuggestions,
    );
    if (accepted.length > 0) {
      container.endpoints = accepted.map(endpointRequestToConfig);
    }
  }

  if (suggestions?.environmentVariablesSuggestions?.length) {
    const env = await promptSuggestedEnv(
      suggestions.environmentVariablesSuggestions,
    );
    if (Object.keys(env).length > 0) {
      container.env = env;
    }
  }

  // --port: retarget any endpoints in the container to the chosen port.
  const portOverride = input.portOverride;
  if (portOverride && container.endpoints) {
    container.endpoints = container.endpoints.map((ep) => ({
      ...ep,
      ports: ep.ports?.map((p) => ({ ...p, container: portOverride })),
    }));
  }

  // --command: split on whitespace and assign as exec-form CMD.
  if (input.commandOverride) {
    container.command = input.commandOverride.trim().split(/\s+/);
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

  if (!input.dryRun) {
    saveConfig(toml, input.configPath);
    logger.success("Wrote bunny.jsonc.");
  } else {
    logger.dim("Would write bunny.jsonc (--dry-run).");
  }

  return { config: toml, registries: { [name]: registry.id } };
}

/**
 * Compose import path: translate `compose.yml` → `bunny.jsonc` and write.
 *
 * Compose carries the container topology, env, ports, and volumes.
 * The user still has to choose:
 *   - app name (compose has no app-level name)
 *   - region (compose isn't region-aware)
 *   - default registry for all containers (assigned to each in translation)
 */
async function runComposeImport(
  client: McClient,
  composeFilePath: string,
  input: WalkthroughInput,
): Promise<WalkthroughResult> {
  const compose = loadComposeFile(composeFilePath);

  const serviceNames = Object.keys(compose.services);
  logger.info(
    `Importing ${serviceNames.length} service${serviceNames.length === 1 ? "" : "s"} from ${basename(composeFilePath)}: ${serviceNames.join(", ")}.`,
  );

  const name = input.nameOverride ?? (await promptAppName());

  const regions = await pickRegions(client);

  let registry: ResolvedRegistry | null;
  if (input.registryFlag) {
    registry = { id: input.registryFlag };
  } else {
    logger.info("Pick a registry to use for all containers.");
    registry = await promptRegistry(client);
  }
  if (!registry) throw new UserError("A registry is required.");

  const { config, warnings } = composeToConfig(compose, {
    composeFilePath,
    appName: name,
    regions,
    defaultRegistryId: registry.id,
  });

  // --command override: if a single service exists, apply it; otherwise
  // warn, because `--command` is ambiguous with multi-service compose files.
  if (input.commandOverride) {
    if (serviceNames.length === 1) {
      const onlyName = serviceNames[0];
      if (onlyName) {
        const primary = config.app.containers[onlyName];
        if (primary) {
          primary.command = input.commandOverride.trim().split(/\s+/);
        }
      }
    } else {
      warnings.push(
        "--command was ignored: pass it via the compose file when multiple services are present.",
      );
    }
  }

  for (const warning of warnings) logger.warn(warning);

  if (!input.dryRun) {
    saveConfig(config, input.configPath);
    logger.success("Wrote bunny.jsonc.");
  } else {
    logger.dim("Would write bunny.jsonc (--dry-run).");
  }

  // Every service in a compose import shares the same registry by default.
  const registries: Record<string, string> = {};
  for (const serviceName of Object.keys(config.app.containers)) {
    registries[serviceName] = registry.id;
  }
  return { config, registries };
}

async function promptAppName(suggested?: string): Promise<string> {
  const initial = suggested?.trim() || basename(resolve(process.cwd()));
  const { value } = await prompts({
    type: "text",
    name: "value",
    message: "App name:",
    initial,
  });
  if (!value) throw new UserError("App name is required.");
  return value;
}

async function pickRegions(client: McClient): Promise<string[]> {
  const spin = spinner("Fetching regions...");
  spin.start();
  const { data: regionsResult } = await client.GET("/regions");
  spin.stop();

  const regionsWithCapacity = (regionsResult?.items ?? []).filter(
    (r): r is typeof r & { id: string } =>
      r.hasCapacity === true && typeof r.id === "string",
  );

  if (regionsWithCapacity.length === 0) {
    throw new UserError("No regions with capacity are available right now.");
  }

  // MVP scope: single-region deploys. Users can edit `bunny.jsonc` to
  // add more regions later: the schema already supports an array.
  const { value: selectedRegion } = await prompts({
    type: "select",
    name: "value",
    message: "Region:",
    choices: regionsWithCapacity.map((r) => ({
      title: `${r.name} (${r.id})`,
      value: r.id,
    })),
  });

  if (!selectedRegion) {
    throw new UserError("A region must be selected.");
  }
  return [selectedRegion];
}
