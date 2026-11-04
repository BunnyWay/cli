import type { components } from "@bunny.net/openapi-client/generated/magic-containers.d.ts";
import { parseImageRef } from "./parse-image-ref.ts";
import {
  type BunnyAppConfig,
  type ContainerConfig,
  CURRENT_VERSION,
  type EndpointConfig,
  normalizeRegions,
} from "./schema.ts";

type Application = components["schemas"]["Application"];
type ContainerTemplate = components["schemas"]["ContainerTemplate"];
type AddApplicationRequest = components["schemas"]["AddApplicationRequest"];
type ContainerRequest = components["schemas"]["ContainerRequest"];
type PatchApplicationRequest = components["schemas"]["PatchApplicationRequest"];
type EndpointRequest = components["schemas"]["EndpointRequest"];
type VolumeRequest = components["schemas"]["VolumeRequest"];

function containerTemplateToConfig(ct: ContainerTemplate): ContainerConfig {
  const config: ContainerConfig = {};

  if (ct.image) {
    const [repository, digest] = ct.image.split("@");
    config.image =
      digest && ct.imageTag ? `${repository}:${ct.imageTag}` : ct.image;
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
    config.endpoints = ct.endpoints.map((ep) => {
      const type = ep.type.toLowerCase() as "cdn" | "anycast";

      return {
        type,
        ...(ep.displayName !== type ? { name: ep.displayName } : {}),
        ...(ep.isSslEnabled != null ? { ssl: ep.isSslEnabled } : {}),
        ports: ep.portMappings.map((pm) => ({
          ...(pm.exposedPort != null ? { public: pm.exposedPort } : {}),
          container: pm.containerPort,
        })),
      };
    });
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

/** Convert an API Application response to BunnyAppConfig. */
export function apiToConfig(app: Application): BunnyAppConfig {
  const volumeSizeMap = new Map(app.volumes.map((v) => [v.name, v.size]));

  const containers: Record<
    string,
    ReturnType<typeof containerTemplateToConfig>
  > = {};
  for (const ct of app.containerTemplates) {
    const c = containerTemplateToConfig(ct);
    if (c.volumes) {
      for (const vol of c.volumes) {
        vol.size = volumeSizeMap.get(vol.name) ?? 0;
      }
    }
    containers[ct.name] = c;
  }

  const config: BunnyAppConfig = {
    version: CURRENT_VERSION,
    app: {
      id: app.id,
      name: app.name,
      containers,
    },
  };

  if (app.autoScaling) {
    config.app.scaling = {
      min: app.autoScaling.min,
      max: app.autoScaling.max,
    };
  }

  const allowed = app.regionSettings.allowedRegionIds;
  const required = app.regionSettings.requiredRegionIds;
  if (allowed.length > 0 || required.length > 0) {
    // Collapse to the simple array form when allowed === required.
    const same =
      allowed.length === required.length &&
      allowed.every((id) => required.includes(id));
    config.app.regions = same ? [...allowed] : { allowed, required };
  }

  return config;
}

function containerConfigToRequest(
  name: string,
  config: ContainerConfig,
  endpointNames: Set<string>,
  id?: string,
): ContainerRequest {
  const image = config.image ?? "";
  const { imageName, imageNamespace, imageTag, imageDigest } =
    parseImageRef(image);

  const req: ContainerRequest = {
    id: id ?? undefined,
    name,
    image,
    imageName,
    imageNamespace,
    imageTag,
    ...(imageDigest ? { imageDigest } : {}),
    imageRegistryId: config.registry ?? "",
    imagePullPolicy: "always",
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
    req.endpoints = config.endpoints.map((ep) => {
      let displayName = ep.name ?? ep.type;
      for (let n = 2; !ep.name && endpointNames.has(displayName); n++) {
        displayName = `${ep.type}-${n}`;
      }

      endpointNames.add(displayName);

      return endpointConfigToRequest(ep, displayName);
    });
  }

  req.volumeMounts = (config.volumes ?? []).map((v) => ({
    name: v.name,
    mountPath: v.mount,
  }));

  return req;
}

function endpointConfigToRequest(
  ep: EndpointConfig,
  displayName: string,
): EndpointRequest {
  const req: EndpointRequest = { displayName };

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
      type: "iPv4",
      portMappings: (ep.ports ?? []).map((p) => ({
        containerPort: p.container,
        exposedPort: p.public,
      })),
    };
  }

  return req;
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

/**
 * Per-container registry ID overrides supplied at request-build time.
 *
 * Registry IDs are account-scoped (the same image can be reached via
 * different account-side registry records) and so don't live in
 * `bunny.jsonc`. Callers pass them in here from whatever per-user state
 * they keep - the CLI uses `.bunny/manifest.json`.
 */
export type RegistryMap = Record<string, string | undefined>;

function mergeRegistry(
  name: string,
  c: ContainerConfig,
  registries: RegistryMap | undefined,
): ContainerConfig {
  const override = registries?.[name];
  if (!override) return c;
  return { ...c, registry: override };
}

/** Pair config containers with app templates by name; one leftover on each side is a rename. */
function matchTemplates(
  names: string[],
  templates: ContainerTemplate[],
): Map<string, ContainerTemplate> {
  const matches = new Map<string, ContainerTemplate>();
  for (const name of names) {
    const template = templates.find((t) => t.name === name);
    if (template) matches.set(name, template);
  }

  const unmatchedNames = names.filter((name) => !matches.has(name));
  const matched = new Set(matches.values());
  const unmatchedTemplates = templates.filter((t) => !matched.has(t));
  const [renamed] = unmatchedNames;
  const [template] = unmatchedTemplates;

  if (
    renamed &&
    template &&
    unmatchedNames.length === 1 &&
    unmatchedTemplates.length === 1
  ) {
    matches.set(renamed, template);
  }

  return matches;
}

/** Convert BunnyAppConfig to an AddApplicationRequest for creating a new app. */
export function configToAddRequest(
  config: BunnyAppConfig,
  registries?: RegistryMap,
): AddApplicationRequest {
  const containers: ContainerRequest[] = [];
  const volumes: VolumeRequest[] = [];
  const seenVolumes = new Set<string>();
  const endpointNames = new Set<string>();

  for (const [name, c] of Object.entries(config.app.containers)) {
    const merged = mergeRegistry(name, c, registries);
    containers.push(containerConfigToRequest(name, merged, endpointNames));
    collectVolumes(merged, volumes, seenVolumes);
  }

  return {
    name: config.app.name,
    runtimeType: "shared",
    autoScaling: config.app.scaling ?? { min: 1, max: 1 },
    regionSettings: (() => {
      const { allowed, required } = normalizeRegions(config.app.regions);
      return { allowedRegionIds: allowed, requiredRegionIds: required };
    })(),
    containerTemplates: containers,
    volumes,
  };
}

/** Convert BunnyAppConfig to a PatchApplicationRequest for updating an existing app. */
export function configToPatchRequest(
  config: BunnyAppConfig,
  existingApp: Application,
  registries?: RegistryMap,
): PatchApplicationRequest {
  const containers: ContainerRequest[] = [];
  const volumes: VolumeRequest[] = [];
  const seenVolumes = new Set<string>();

  const endpointNames = new Set<string>();

  const entries = Object.entries(config.app.containers);
  const matches = matchTemplates(
    entries.map(([name]) => name),
    existingApp.containerTemplates,
  );

  for (const [name, c] of entries) {
    const existing = matches.get(name);
    const merged = mergeRegistry(name, c, registries);

    if (!merged.registry && existing?.imageRegistryId) {
      merged.registry = existing.imageRegistryId;
    }

    const req = containerConfigToRequest(
      name,
      merged,
      endpointNames,
      existing?.id,
    );
    // PATCH replaces the whole template, so a config without an env block must carry over the server's vars or they get wiped.
    if (!merged.env && existing?.environmentVariables?.length) {
      req.environmentVariables = existing.environmentVariables;
    }
    containers.push(req);
    collectVolumes(merged, volumes, seenVolumes);
  }

  return {
    name: config.app.name,
    runtimeType: "shared",
    autoScaling: config.app.scaling ?? { min: 1, max: 1 },
    regionSettings: (() => {
      const { allowed, required } = normalizeRegions(config.app.regions);
      return { allowedRegionIds: allowed, requiredRegionIds: required };
    })(),
    containerTemplates: containers,
    volumes,
  };
}
