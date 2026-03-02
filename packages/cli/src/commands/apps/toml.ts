import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { parse, stringify } from "smol-toml";
import type { components } from "@bunny.net/api/generated/magic-containers.d.ts";
import { UserError } from "../../core/errors.ts";

type Application = components["schemas"]["Application"];
type ContainerTemplate = components["schemas"]["ContainerTemplate"];
type AddApplicationRequest = components["schemas"]["AddApplicationRequest"];
type ContainerRequest = components["schemas"]["ContainerRequest"];
type PatchApplicationRequest = components["schemas"]["PatchApplicationRequest"];
type EndpointRequest = components["schemas"]["EndpointRequest"];
type VolumeRequest = components["schemas"]["VolumeRequest"];
type VolumeMountRequest = components["schemas"]["VolumeMountRequest"];

const TOML_FILENAME = "bunny.toml";

// ─── BunnyToml interfaces ────────────────────────────────────────────

export interface ProbeConfig {
  type: "http" | "tcp" | "grpc";
  path?: string;
  port?: number;
}

export interface EndpointConfig {
  type: "cdn" | "anycast";
  ssl?: boolean;
  ports?: Array<{ public: number; container: number }>;
}

export interface VolumeConfig {
  name: string;
  mount: string;
  size: number;
}

export interface ContainerConfig {
  image?: string;
  dockerfile?: string;
  command?: string[];
  registry?: string;
  env?: Record<string, string>;
  probes?: {
    readiness?: ProbeConfig;
    liveness?: ProbeConfig;
    startup?: ProbeConfig;
  };
  endpoints?: EndpointConfig[];
  volumes?: VolumeConfig[];
}

export interface BunnyToml {
  app: {
    id?: string;
    name: string;
    runtime?: "shared" | "reserved";
    scaling?: { min: number; max: number };
    regions?: {
      allowed?: string[];
      required?: string[];
    };
    container: ContainerConfig;
  };
  accessories?: Record<string, ContainerConfig>;
}

// ─── File I/O ────────────────────────────────────────────────────────

function findTomlRoot(): string {
  let dir = resolve(process.cwd());

  while (true) {
    if (existsSync(join(dir, TOML_FILENAME))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

/** Load and parse bunny.toml from cwd or nearest ancestor. */
export function loadBunnyToml(): BunnyToml {
  const root = findTomlRoot();
  const path = join(root, TOML_FILENAME);

  if (!existsSync(path)) {
    throw new UserError(
      "No bunny.toml found.",
      "Run `bunny apps init` first.",
    );
  }

  const raw = readFileSync(path, "utf-8");
  return parse(raw) as unknown as BunnyToml;
}

/** Write bunny.toml to the given directory (or cwd). */
export function saveBunnyToml(data: BunnyToml, dir?: string): void {
  const target = dir ?? process.cwd();
  const path = join(target, TOML_FILENAME);
  writeFileSync(path, stringify(data as any) + "\n");
}

/** Check if bunny.toml exists in cwd or ancestor. */
export function bunnyTomlExists(): boolean {
  const root = findTomlRoot();
  return existsSync(join(root, TOML_FILENAME));
}

// ─── Resolution helpers ─────────────────────────────────────────────

/**
 * Resolve an app ID from an explicit value or from bunny.toml.
 * Throws if neither source provides an ID.
 */
export function resolveAppId(explicit?: string): string {
  if (explicit) return explicit;

  const toml = loadBunnyToml();
  if (toml.app.id) return toml.app.id;

  throw new UserError(
    "No app ID found in bunny.toml.",
    "Run `bunny apps deploy` to create the app first, or pass --id explicitly.",
  );
}

/**
 * Resolve a container template ID by name.
 * Defaults to the first container (primary) if no name is given.
 */
export function resolveContainerId(
  app: Application,
  containerName?: string,
): string {
  if (!containerName) {
    const primary = app.containerTemplates[0];
    if (!primary) {
      throw new UserError("App has no containers.");
    }
    return primary.id;
  }

  const found = app.containerTemplates.find(
    (c) => c.name.toLowerCase() === containerName.toLowerCase(),
  );

  if (!found) {
    const available = app.containerTemplates.map((c) => c.name).join(", ");
    throw new UserError(
      `Container "${containerName}" not found.`,
      `Available containers: ${available}`,
    );
  }

  return found.id;
}

// ─── API → TOML conversion ──────────────────────────────────────────

function containerTemplateToConfig(ct: ContainerTemplate): ContainerConfig {
  const config: ContainerConfig = {};

  if (ct.image) {
    config.image = ct.image;
  }

  if (ct.entryPoint?.commandArray?.length) {
    config.command = ct.entryPoint.commandArray;
  } else if (ct.entryPoint?.command) {
    config.command = [ct.entryPoint.command];
  }

  if (ct.environmentVariables.length > 0) {
    config.env = Object.fromEntries(
      ct.environmentVariables.map((v) => [v.name, v.value ?? ""]),
    );
  }

  if (ct.endpoints.length > 0) {
    config.endpoints = ct.endpoints.map((ep) => ({
      type: ep.type.toLowerCase() as "cdn" | "anycast",
      ssl: ep.isSslEnabled,
      ports: ep.portMappings.map((pm) => ({
        public: pm.exposedPort,
        container: pm.containerPort,
      })),
    }));
  }

  if (ct.volumeMounts.length > 0) {
    config.volumes = ct.volumeMounts.map((vm) => ({
      name: vm.name,
      mount: vm.mountPath,
      size: 0,
    }));
  }

  return config;
}

/** Convert an API Application response to BunnyToml. */
export function apiToToml(app: Application): BunnyToml {
  const primary = app.containerTemplates[0];
  const accessories = app.containerTemplates.slice(1);

  const toml: BunnyToml = {
    app: {
      id: app.id,
      name: app.name,
      runtime: app.runtimeType.toLowerCase() as "shared" | "reserved",
      container: primary
        ? containerTemplateToConfig(primary)
        : {},
    },
  };

  if (app.autoScaling) {
    toml.app.scaling = {
      min: app.autoScaling.min,
      max: app.autoScaling.max,
    };
  }

  if (
    app.regionSettings.allowedRegionIds.length > 0 ||
    app.regionSettings.requiredRegionIds.length > 0
  ) {
    toml.app.regions = {
      allowed: app.regionSettings.allowedRegionIds,
      required: app.regionSettings.requiredRegionIds,
    };
  }

  // Merge volume sizes from the app-level volumes into container configs
  const volumeSizeMap = new Map(
    app.volumes.map((v) => [v.name, v.size]),
  );

  if (toml.app.container.volumes) {
    for (const vol of toml.app.container.volumes) {
      vol.size = volumeSizeMap.get(vol.name) ?? 0;
    }
  }

  if (accessories.length > 0) {
    toml.accessories = {};
    for (const ct of accessories) {
      const config = containerTemplateToConfig(ct);
      if (config.volumes) {
        for (const vol of config.volumes) {
          vol.size = volumeSizeMap.get(vol.name) ?? 0;
        }
      }
      toml.accessories[ct.name] = config;
    }
  }

  return toml;
}

// ─── TOML → API conversion ──────────────────────────────────────────

/** Parse a Docker image reference into its components. */
export function parseImageRef(ref: string): {
  imageName: string;
  imageNamespace: string;
  imageTag: string;
} {
  let tag = "latest";
  let imagePath = ref;

  const colonIdx = ref.lastIndexOf(":");
  if (colonIdx > 0 && !ref.substring(colonIdx).includes("/")) {
    tag = ref.substring(colonIdx + 1);
    imagePath = ref.substring(0, colonIdx);
  }

  const parts = imagePath.split("/");
  const name = parts.pop() ?? imagePath;
  const namespace = parts.length > 1 ? parts.slice(1).join("/") : parts[0] ?? "";

  return { imageName: name, imageNamespace: namespace, imageTag: tag };
}

function containerConfigToRequest(
  name: string,
  config: ContainerConfig,
  id?: string,
): ContainerRequest {
  const image = config.image ?? "";
  const { imageName, imageNamespace, imageTag } = parseImageRef(image);

  const req: ContainerRequest = {
    id: id ?? undefined,
    name,
    image,
    imageName,
    imageNamespace,
    imageTag,
    imageRegistryId: config.registry ?? "",
  };

  if (config.command) {
    req.entryPoint = { commandArray: config.command };
  }

  if (config.env) {
    req.environmentVariables = Object.entries(config.env).map(
      ([name, value]) => ({ name, value }),
    );
  }

  if (config.endpoints) {
    req.endpoints = config.endpoints.map((ep) => endpointConfigToRequest(ep));
  }

  if (config.volumes) {
    req.volumeMounts = config.volumes.map((v) => ({
      name: v.name,
      mountPath: v.mount,
    }));
  }

  return req;
}

function endpointConfigToRequest(ep: EndpointConfig): EndpointRequest {
  const req: EndpointRequest = {
    displayName: ep.type,
  };

  if (ep.type === "cdn") {
    req.cdn = {
      isSslEnabled: ep.ssl ?? true,
      portMappings: ep.ports?.map((p) => ({
        containerPort: p.container,
        exposedPort: p.public,
      })),
    };
  } else if (ep.type === "anycast") {
    req.anycast = {
      type: "IPv4",
      portMappings: (ep.ports ?? []).map((p) => ({
        containerPort: p.container,
        exposedPort: p.public,
      })),
    };
  }

  return req;
}

/** Convert BunnyToml to an AddApplicationRequest for creating a new app. */
export function tomlToAddRequest(toml: BunnyToml): AddApplicationRequest {
  const containers: ContainerRequest[] = [];
  const volumes: VolumeRequest[] = [];
  const seenVolumes = new Set<string>();

  // Primary container
  containers.push(
    containerConfigToRequest(toml.app.name, toml.app.container),
  );
  collectVolumes(toml.app.container, volumes, seenVolumes);

  // Accessories
  if (toml.accessories) {
    for (const [name, config] of Object.entries(toml.accessories)) {
      containers.push(containerConfigToRequest(name, config));
      collectVolumes(config, volumes, seenVolumes);
    }
  }

  return {
    name: toml.app.name,
    runtimeType: (toml.app.runtime ?? "shared") === "shared" ? "Shared" : "Reserved",
    autoScaling: toml.app.scaling ?? { min: 1, max: 1 },
    regionSettings: {
      allowedRegionIds: toml.app.regions?.allowed ?? [],
      requiredRegionIds: toml.app.regions?.required ?? [],
    },
    containerTemplates: containers,
    volumes,
  };
}

function collectVolumes(
  config: ContainerConfig,
  volumes: VolumeRequest[],
  seen: Set<string>,
): void {
  if (!config.volumes) return;
  for (const v of config.volumes) {
    if (!seen.has(v.name)) {
      seen.add(v.name);
      volumes.push({ name: v.name, size: v.size });
    }
  }
}

/** Convert BunnyToml to a PatchApplicationRequest for updating an existing app. */
export function tomlToPatchRequest(
  toml: BunnyToml,
  existingApp: Application,
): PatchApplicationRequest {
  const containers: ContainerRequest[] = [];
  const volumes: VolumeRequest[] = [];
  const seenVolumes = new Set<string>();

  // Primary container — keep existing ID (first container)
  const primaryId = existingApp.containerTemplates[0]?.id;
  containers.push(
    containerConfigToRequest(
      toml.app.name,
      toml.app.container,
      primaryId,
    ),
  );
  collectVolumes(toml.app.container, volumes, seenVolumes);

  // Accessories — match by name to preserve IDs
  if (toml.accessories) {
    for (const [name, config] of Object.entries(toml.accessories)) {
      const existing = existingApp.containerTemplates.find(
        (ct) => ct.name === name,
      );
      containers.push(containerConfigToRequest(name, config, existing?.id));
      collectVolumes(config, volumes, seenVolumes);
    }
  }

  return {
    name: toml.app.name,
    runtimeType: (toml.app.runtime ?? "shared") === "shared" ? "Shared" : "Reserved",
    autoScaling: toml.app.scaling ?? { min: 1, max: 1 },
    regionSettings: {
      allowedRegionIds: toml.app.regions?.allowed ?? [],
      requiredRegionIds: toml.app.regions?.required ?? [],
    },
    containerTemplates: containers,
    volumes,
  };
}
