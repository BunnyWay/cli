import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { prompts, spinner } from "../../core/ui.ts";
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
  assignContainerNamesToDockerfiles,
  ensureDockerAvailable,
  findDockerfiles,
  getConfigSuggestions,
  isDockerfileName,
  type McClient,
  promptRegistry,
  type ResolvedRegistry,
  readDockerfileExposedPorts,
  resolveRegistryForImage,
} from "./docker.ts";
import { parseDotenv } from "./env/parse.ts";
import {
  confirmEndpointSuggestions,
  endpointRequestToConfig,
  promptSuggestedEnv,
} from "./suggestions.ts";

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
    const detectedDockerfiles = findDockerfiles(process.cwd());

    const composeServicesCount = composeFile
      ? Object.keys(loadComposeFile(composeFile).services).length
      : 0;

    const dockerfileChoiceTitle =
      detectedDockerfiles.length === 0
        ? "Build from a Dockerfile (enter path)"
        : detectedDockerfiles.length === 1
          ? `Build from ${detectedDockerfiles[0]}`
          : `Build from Dockerfile(s) (${detectedDockerfiles.length} detected)`;

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
        { title: dockerfileChoiceTitle, value: "dockerfile" },
        { title: "Deploy a pre-built image", value: "image" },
      ],
    });
    if (!value) throw new UserError("Setup cancelled.");

    // Bail before any further prompts / disk writes if Docker is missing.
    // Both "compose" and "dockerfile" picks always end in a local build;
    // without Docker we'd write `bunny.jsonc` and then crash mid-deploy.
    if (value === "compose" || value === "dockerfile") {
      await ensureDockerAvailable();
    }

    if (value === "compose" && composeFile) {
      return runComposeImport(client, composeFile, input);
    }

    if (value === "dockerfile") {
      const selectedPaths = await chooseDockerfiles(detectedDockerfiles);
      if (selectedPaths.length === 0) {
        throw new UserError("At least one Dockerfile is required.");
      }
      if (selectedPaths.length > 1) {
        return runMultiDockerfileImport(client, selectedPaths, input);
      }
      dockerfilePath = selectedPaths[0];
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
    if (input.contextFlag) {
      container.context = input.contextFlag;
    } else if (defaultBuildContextForDockerfile(dockerfilePath)) {
      // Subdirectory Dockerfile - assume monorepo layout where the build
      // context is the repo root rather than the Dockerfile's parent.
      container.context = ".";
      logger.dim(
        `Using cwd as build context for ${dockerfilePath} (monorepo default; edit \`containers.${name}.context\` in bunny.jsonc to override).`,
      );
    }
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

  // Build mode: bunny.net can't see env defaults until the image is
  // pushed. Compensate by scanning the Dockerfile's neighbourhood for a
  // `.env` / `.env.example` and offering those keys for inclusion.
  if (mode === "build" && dockerfilePath) {
    const picked = await pickEnvKeysFromDockerfile(dockerfilePath, name);
    if (Object.keys(picked).length > 0) {
      container.env = { ...(container.env ?? {}), ...picked };
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

  printEnvHint(toml, input.configPath);

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

/**
 * After the walkthrough writes `bunny.jsonc`, summarise any self-pointer
 * env keys (where `env[key] === key`) that still need a value supplied at
 * deploy time. The resolution happens in {@link resolveContainerEnv},
 * which reads from a `.env` file sitting next to `bunny.jsonc`.
 *
 * Missing keys aren't an error — bunny.net will accept the literal key as
 * the value if no resolution happens — but they're almost always not what
 * the user wanted, so we surface the gap loudly while it's still cheap to
 * fix.
 */
function printEnvHint(config: BunnyAppConfig, configPath?: string): void {
  const pointerKeys = new Set<string>();
  for (const container of Object.values(config.app.containers)) {
    if (!container.env) continue;
    for (const [key, value] of Object.entries(container.env)) {
      if (value === key) pointerKeys.add(key);
    }
  }
  if (pointerKeys.size === 0) return;

  const dotenvPath = configPath
    ? resolve(dirname(configPath), ".env")
    : resolve(process.cwd(), ".env");

  logger.log();
  logger.dim(
    `Resolve these env keys at deploy time by adding them to ${dotenvPath}:`,
  );
  for (const key of [...pointerKeys].sort()) {
    logger.dim(`  ${key}=`);
  }
}

// Files we'll search next to a Dockerfile to bootstrap container env.
// Order matters: `.env` reflects the values currently in use, so its key
// set is the most accurate; `.env.example` is the documentation fallback.
const ENV_CANDIDATE_FILES = [".env", ".env.example"] as const;

/**
 * Read `.env` / `.env.example` next to the Dockerfile (and at cwd as a
 * fallback for monorepos that share a root `.env.example`), parse out
 * the keys, and return a sorted, deduped union. Returns `[]` if nothing
 * resolves so callers can skip prompting entirely.
 *
 * Values are never read into memory beyond the parse step - we only need
 * the key set. The actual values stay in the user's `.env` and are
 * resolved at deploy time by {@link resolveContainerEnv}.
 */
function discoverEnvKeysForDockerfile(dockerfilePath: string): string[] {
  const dockerfileDir = dirname(resolve(process.cwd(), dockerfilePath));
  const cwd = resolve(process.cwd());
  const candidates: string[] = [];
  for (const file of ENV_CANDIDATE_FILES) {
    candidates.push(resolve(dockerfileDir, file));
    if (dockerfileDir !== cwd) candidates.push(resolve(cwd, file));
  }

  const keys = new Set<string>();
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed = parseDotenv(readFileSync(candidate, "utf-8"));
      for (const key of Object.keys(parsed)) keys.add(key);
    } catch {
      // Unreadable file - ignore. Surfacing an error here would block
      // the walkthrough on a totally peripheral concern.
    }
  }

  return [...keys].sort();
}

/**
 * Interactive: offer the user a multi-select of env keys discovered next
 * to a Dockerfile, and return a self-pointer map (`KEY: KEY`) for the
 * selected ones. Empty map when no keys found or the user picks none.
 *
 * The self-pointer pattern lets {@link resolveContainerEnv} fill in
 * actual values from a root `.env` at deploy time without storing
 * secrets in the committed `bunny.jsonc`.
 */
async function pickEnvKeysFromDockerfile(
  dockerfilePath: string,
  containerName: string,
): Promise<Record<string, string>> {
  const keys = discoverEnvKeysForDockerfile(dockerfilePath);
  if (keys.length === 0) return {};

  const { picked } = await prompts({
    type: "multiselect",
    name: "picked",
    message: `Env keys to set on "${containerName}" (from .env / .env.example near ${dockerfilePath}):`,
    choices: keys.map((key) => ({ title: key, value: key, selected: true })),
    hint: "space to toggle, enter to confirm",
    instructions: false,
  });

  const result: Record<string, string> = {};
  if (Array.isArray(picked)) {
    for (const key of picked) {
      if (typeof key === "string") result[key] = key;
    }
  }
  return result;
}

/**
 * Decide whether a Dockerfile needs an explicit build-context override.
 *
 * For a root `Dockerfile`, docker's default context (the directory `-f`
 * resolves from) is already correct - no override needed.
 *
 * For a Dockerfile in a subdirectory (e.g. `apps/web/Dockerfile`), the
 * default would point at `apps/web/`. In a monorepo that's almost always
 * wrong: the Dockerfile references workspace files (`pnpm-lock.yaml`,
 * `apps/web/package.json`) that only resolve when the build context is
 * the repo root. Returns `true` so callers know to set `container.context`
 * to cwd.
 */
function defaultBuildContextForDockerfile(dockerfilePath: string): boolean {
  return dockerfilePath.includes("/");
}

/**
 * Resolve the set of Dockerfile paths the user wants to build.
 *
 * - 0 detected → straight to manual entry; user must supply at least one path.
 * - 1 detected → ask "use this, or pick a different path?".
 * - 2+ detected → multi-select; any combination (including none) is fine,
 *   and the add-another loop after this can extend the list.
 *
 * In every case we offer an "add another" loop so users with Dockerfiles
 * the scanner missed (deeper than the cap, or with non-conventional
 * filenames) can still include them. Returns paths relative to cwd
 * where possible.
 */
async function chooseDockerfiles(detected: string[]): Promise<string[]> {
  const selected: string[] = [];

  if (detected.length === 1) {
    const onlyMatch = detected[0];
    if (!onlyMatch) throw new UserError("No Dockerfile path resolved.");
    const { useDetected } = await prompts({
      type: "confirm",
      name: "useDetected",
      message: `Use detected Dockerfile (${onlyMatch})?`,
      initial: true,
    });
    if (useDetected) selected.push(onlyMatch);
  } else if (detected.length > 1) {
    const { picked } = await prompts({
      type: "multiselect",
      name: "picked",
      message: "Select Dockerfile(s) to deploy as containers:",
      // Pre-selected so plain enter accepts all detected files.
      choices: detected.map((path) => ({
        title: path,
        value: path,
        selected: true,
      })),
      hint: "space to toggle, enter to confirm",
      instructions: false,
    });
    if (Array.isArray(picked)) {
      for (const path of picked) {
        if (typeof path === "string") selected.push(path);
      }
    }
  }

  // Default-on only when nothing was detected — otherwise an empty pick
  // is an explicit "no", not a cue to prompt for a manual path.
  while (true) {
    const { addAnother } = await prompts({
      type: "confirm",
      name: "addAnother",
      message:
        selected.length === 0
          ? "Add a Dockerfile path?"
          : "Add another Dockerfile?",
      initial: detected.length === 0 && selected.length === 0,
    });
    if (!addAnother) break;

    const { path } = await prompts({
      type: "text",
      name: "path",
      message: "Dockerfile path (relative to cwd):",
      validate: (input: string) => {
        if (!input?.trim()) return "Path cannot be empty.";
        const abs = isAbsolute(input)
          ? input
          : resolve(process.cwd(), input.trim());
        if (!existsSync(abs)) return `No file found at ${input}.`;
        if (!isDockerfileName(basename(abs)))
          return "File does not look like a Dockerfile.";
        return true;
      },
    });
    if (!path) break;

    const trimmed = path.trim();
    const abs = isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed);
    const rel = relative(process.cwd(), abs) || trimmed;
    if (!selected.includes(rel)) selected.push(rel);
  }

  return selected;
}

/**
 * Multi-Dockerfile import path: build a multi-container `bunny.jsonc`
 * from the user's Dockerfile picks.
 *
 * Mirrors the shape of {@link runComposeImport}: one registry is shared
 * across every container (deploy can re-prompt per container later if
 * needed), endpoints are seeded from each Dockerfile's `EXPOSE`
 * directives, container names are derived from path conventions, and
 * the file is saved unless `dryRun` is set.
 */
async function runMultiDockerfileImport(
  client: McClient,
  dockerfilePaths: string[],
  input: WalkthroughInput,
): Promise<WalkthroughResult> {
  const named = assignContainerNamesToDockerfiles(dockerfilePaths);

  logger.info(
    `Importing ${named.length} container${named.length === 1 ? "" : "s"}: ${named.map((n) => `${n.name} (${n.path})`).join(", ")}.`,
  );

  if (named.some(({ path }) => defaultBuildContextForDockerfile(path))) {
    logger.dim(
      "Build context defaulted to cwd for Dockerfiles in subdirectories (typical monorepo layout). Edit `containers.<name>.context` in bunny.jsonc to override per container.",
    );
  }

  const name = input.nameOverride ?? (await promptAppName());

  const regions = await pickRegions(client);

  let registry: ResolvedRegistry | null;
  if (input.registryFlag) {
    registry = { id: input.registryFlag };
  } else {
    logger.info("Pick a registry to push all images to.");
    registry = await promptRegistry(client);
  }
  if (!registry) throw new UserError("A registry is required.");

  const containers: Record<string, ContainerConfig> = {};
  for (const { path, name: containerName } of named) {
    const container: ContainerConfig = { dockerfile: path };

    // Monorepo Dockerfiles almost always expect the build context at the
    // repo root - they reference workspace-level files like
    // `pnpm-lock.yaml` and sibling-package paths like
    // `apps/web/package.json`. Default to cwd so the build "just works";
    // user can override per-container in bunny.jsonc afterward.
    if (defaultBuildContextForDockerfile(path)) {
      container.context = ".";
    }

    // Seed endpoints from EXPOSE so each container has a reachable port
    // when MC stands it up. Same shape compose translation produces - one
    // CDN endpoint with every exposed port grouped under it.
    const exposedPorts = await readDockerfileExposedPorts(
      resolve(process.cwd(), path),
    );
    if (exposedPorts.length > 0) {
      container.endpoints = [
        {
          type: "cdn",
          ssl: true,
          ports: exposedPorts.map((port) => ({
            public: 443,
            container: port,
          })),
        },
      ];
    }

    const pickedEnv = await pickEnvKeysFromDockerfile(path, containerName);
    if (Object.keys(pickedEnv).length > 0) {
      container.env = pickedEnv;
    }

    containers[containerName] = container;
  }

  // --command is ambiguous with multiple containers — same rule as
  // multi-service compose imports.
  if (input.commandOverride) {
    logger.warn(
      "--command was ignored: pass it per container in bunny.jsonc when multiple Dockerfiles are selected.",
    );
  }

  // --port likewise can't sensibly target one of N containers.
  if (input.portOverride !== undefined) {
    logger.warn(
      "--port was ignored: set the container port per container in bunny.jsonc when multiple Dockerfiles are selected.",
    );
  }

  const config: BunnyAppConfig = {
    version: CURRENT_VERSION,
    app: {
      name,
      scaling: { min: 1, max: 1 },
      regions,
      containers,
    },
  };

  if (!input.dryRun) {
    saveConfig(config, input.configPath);
    logger.success("Wrote bunny.jsonc.");
  } else {
    logger.dim("Would write bunny.jsonc (--dry-run).");
  }

  printEnvHint(config, input.configPath);

  const registries: Record<string, string> = {};
  for (const containerName of Object.keys(containers)) {
    registries[containerName] = registry.id;
  }
  return { config, registries };
}
