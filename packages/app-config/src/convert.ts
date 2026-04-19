import type { components } from "@bunny.net/api/generated/magic-containers.d.ts";
import { parseImageRef } from "./parse-image-ref.ts";
import type {
  BunnyAppConfig,
  ContainerConfig,
  EndpointConfig,
} from "./schema.ts";

type Application = components["schemas"]["Application"];
type ContainerTemplate = components["schemas"]["ContainerTemplate"];
type AddApplicationRequest = components["schemas"]["AddApplicationRequest"];
type ContainerRequest = components["schemas"]["ContainerRequest"];
type PatchApplicationRequest = components["schemas"]["PatchApplicationRequest"];
type EndpointRequest = components["schemas"]["EndpointRequest"];
type VolumeRequest = components["schemas"]["VolumeRequest"];

// ─── API → Config conversion ────────────────────────────────────────

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

  if (
    app.regionSettings.allowedRegionIds.length > 0 ||
    app.regionSettings.requiredRegionIds.length > 0
  ) {
    config.app.regions = {
      allowed: app.regionSettings.allowedRegionIds,
      required: app.regionSettings.requiredRegionIds,
    };
  }

  return config;
}

// ─── Config → API conversion ────────────────────────────────────────

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

/** Convert BunnyAppConfig to an AddApplicationRequest for creating a new app. */
export function configToAddRequest(
  config: BunnyAppConfig,
): AddApplicationRequest {
  const containers: ContainerRequest[] = [];
  const volumes: VolumeRequest[] = [];
  const seenVolumes = new Set<string>();

  for (const [name, c] of Object.entries(config.app.containers)) {
    containers.push(containerConfigToRequest(name, c));
    collectVolumes(c, volumes, seenVolumes);
  }

  return {
    name: config.app.name,
    runtimeType: "Shared",
    autoScaling: config.app.scaling ?? { min: 1, max: 1 },
    regionSettings: {
      allowedRegionIds: config.app.regions?.allowed ?? [],
      requiredRegionIds: config.app.regions?.required ?? [],
    },
    containerTemplates: containers,
    volumes,
  };
}

/** Convert BunnyAppConfig to a PatchApplicationRequest for updating an existing app. */
export function configToPatchRequest(
  config: BunnyAppConfig,
  existingApp: Application,
): PatchApplicationRequest {
  const containers: ContainerRequest[] = [];
  const volumes: VolumeRequest[] = [];
  const seenVolumes = new Set<string>();

  // Match containers by name to preserve existing IDs
  const entries = Object.entries(config.app.containers);
  for (const [i, [name, c]] of entries.entries()) {
    // First container matches first existing template (primary); rest match by name
    const existing =
      i === 0
        ? existingApp.containerTemplates[0]
        : existingApp.containerTemplates.find((ct) => ct.name === name);
    containers.push(containerConfigToRequest(name, c, existing?.id));
    collectVolumes(c, volumes, seenVolumes);
  }

  return {
    name: config.app.name,
    runtimeType: "Shared",
    autoScaling: config.app.scaling ?? { min: 1, max: 1 },
    regionSettings: {
      allowedRegionIds: config.app.regions?.allowed ?? [],
      requiredRegionIds: config.app.regions?.required ?? [],
    },
    containerTemplates: containers,
    volumes,
  };
}
