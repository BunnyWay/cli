import { describe, expect, test } from "bun:test";
import type { components } from "@bunny.net/openapi-client/generated/magic-containers.d.ts";
import {
  apiToConfig,
  configToAddRequest,
  configToPatchRequest,
} from "./convert.ts";
import { CURRENT_VERSION } from "./schema.ts";

type Application = components["schemas"]["Application"];
type ContainerTemplate = components["schemas"]["ContainerTemplate"];

// Building real `Application` objects requires every nested required field;
// for unit tests we lean on `as Application` after constructing the subset
// the conversion code actually reads.

function template(overrides: Partial<ContainerTemplate>): ContainerTemplate {
  return {
    id: "ct_1",
    name: "api",
    packageId: "pkg_1",
    image: "ghcr.io/me/api:v1",
    imageName: "api",
    imageNamespace: "me",
    imageTag: "v1",
    imageRegistryId: "12345",
    imageDigest: "",
    environmentVariables: [],
    endpoints: [],
    volumeMounts: [],
    ...overrides,
  } as ContainerTemplate;
}

function app(overrides: Partial<Application>): Application {
  return {
    id: "app_1",
    name: "my-app",
    containerTemplates: [template({})],
    containerInstances: [],
    volumes: [],
    regionSettings: { allowedRegionIds: [], requiredRegionIds: [] },
    ...overrides,
  } as Application;
}

describe("apiToConfig", () => {
  test("emits CURRENT_VERSION and basic app fields", () => {
    const result = apiToConfig(app({ id: "app_42", name: "my-api" }));
    expect(result.version).toBe(CURRENT_VERSION);
    expect(result.app.id).toBe("app_42");
    expect(result.app.name).toBe("my-api");
  });

  test("maps container image", () => {
    const result = apiToConfig(
      app({
        containerTemplates: [template({ name: "web", image: "nginx:1.27" })],
      }),
    );
    expect(result.app.containers.web?.image).toBe("nginx:1.27");
  });

  test("prefers commandArray over command when both are present", () => {
    const result = apiToConfig(
      app({
        containerTemplates: [
          template({
            entryPoint: {
              command: "/start.sh",
              commandArray: ["bash", "-c", "/start.sh"],
            },
          }),
        ],
      }),
    );
    expect(result.app.containers.api?.command).toEqual([
      "bash",
      "-c",
      "/start.sh",
    ]);
  });

  test("wraps single command string in a one-element array", () => {
    const result = apiToConfig(
      app({
        containerTemplates: [
          template({
            entryPoint: { command: "/start.sh" },
          }),
        ],
      }),
    );
    expect(result.app.containers.api?.command).toEqual(["/start.sh"]);
  });

  test("populates env from environmentVariables", () => {
    const result = apiToConfig(
      app({
        containerTemplates: [
          template({
            environmentVariables: [
              { name: "PORT", value: "3000" },
              { name: "DEBUG", value: "true" },
              { name: "EMPTY", value: undefined } as unknown as {
                name: string;
                value: string;
              },
            ],
          }),
        ],
      }),
    );
    expect(result.app.containers.api?.env).toEqual({
      PORT: "3000",
      DEBUG: "true",
      EMPTY: "",
    });
  });

  test("maps endpoints to lowercase type with public/container port pairs", () => {
    const result = apiToConfig(
      app({
        containerTemplates: [
          template({
            endpoints: [
              {
                displayName: "web",
                publicHost: "example.com",
                type: "cdn",
                isSslEnabled: true,
                pullZoneId: "pz_1",
                portMappings: [
                  {
                    exposedPort: 443,
                    containerPort: 3000,
                    protocols: ["tcp"],
                  },
                ],
              },
            ],
          }),
        ],
      }),
    );
    expect(result.app.containers.api?.endpoints).toEqual([
      {
        type: "cdn",
        ssl: true,
        ports: [{ public: 443, container: 3000 }],
      },
    ]);
  });

  test("resolves volume sizes from app.volumes", () => {
    const result = apiToConfig(
      app({
        volumes: [
          { name: "data", size: 50 },
          { name: "cache", size: 10 },
        ],
        containerTemplates: [
          template({
            volumeMounts: [
              { name: "data", mountPath: "/data" },
              { name: "unknown", mountPath: "/unknown" },
            ],
          }),
        ],
      }),
    );
    expect(result.app.containers.api?.volumes).toEqual([
      { name: "data", mount: "/data", size: 50 },
      { name: "unknown", mount: "/unknown", size: 0 },
    ]);
  });

  test("includes autoScaling when set", () => {
    const result = apiToConfig(app({ autoScaling: { min: 2, max: 5 } }));
    expect(result.app.scaling).toEqual({ min: 2, max: 5 });
  });

  test("collapses regions to array when allowed === required", () => {
    const result = apiToConfig(
      app({
        regionSettings: {
          allowedRegionIds: ["sfo", "lhr"],
          requiredRegionIds: ["sfo", "lhr"],
        },
      }),
    );
    expect(result.app.regions).toEqual(["sfo", "lhr"]);
  });

  test("emits regions as object when allowed and required differ", () => {
    const result = apiToConfig(
      app({
        regionSettings: {
          allowedRegionIds: ["sfo", "lhr", "nyc"],
          requiredRegionIds: ["sfo"],
        },
      }),
    );
    expect(result.app.regions).toEqual({
      allowed: ["sfo", "lhr", "nyc"],
      required: ["sfo"],
    });
  });

  test("omits regions when both are empty", () => {
    const result = apiToConfig(app({}));
    expect(result.app.regions).toBeUndefined();
  });

  test("multiple containers keyed by name", () => {
    const result = apiToConfig(
      app({
        containerTemplates: [
          template({ id: "ct_1", name: "api", image: "ghcr.io/me/api:v1" }),
          template({ id: "ct_2", name: "db", image: "postgres:16" }),
        ],
      }),
    );
    expect(Object.keys(result.app.containers)).toEqual(["api", "db"]);
    expect(result.app.containers.db?.image).toBe("postgres:16");
  });
});

describe("configToAddRequest", () => {
  test("parses image ref into name/namespace/tag", () => {
    const req = configToAddRequest({
      version: CURRENT_VERSION,
      app: {
        name: "x",
        containers: {
          api: { image: "ghcr.io/me/api:v1.2", registry: "12345" },
        },
      },
    });
    const c = req.containerTemplates?.[0];
    expect(c?.imageName).toBe("api");
    expect(c?.imageNamespace).toBe("me");
    expect(c?.imageTag).toBe("v1.2");
    expect(c?.imageRegistryId).toBe("12345");
  });

  test("regions array fills both allowedRegionIds and requiredRegionIds", () => {
    const req = configToAddRequest({
      version: CURRENT_VERSION,
      app: {
        name: "x",
        regions: ["sfo", "lhr"],
        containers: { api: { image: "nginx" } },
      },
    });
    expect(req.regionSettings.allowedRegionIds).toEqual(["sfo", "lhr"]);
    expect(req.regionSettings.requiredRegionIds).toEqual(["sfo", "lhr"]);
  });

  test("regions object form is passed through", () => {
    const req = configToAddRequest({
      version: CURRENT_VERSION,
      app: {
        name: "x",
        regions: { allowed: ["sfo", "lhr"], required: ["sfo"] },
        containers: { api: { image: "nginx" } },
      },
    });
    expect(req.regionSettings.allowedRegionIds).toEqual(["sfo", "lhr"]);
    expect(req.regionSettings.requiredRegionIds).toEqual(["sfo"]);
  });

  test("missing regions yields empty arrays", () => {
    const req = configToAddRequest({
      version: CURRENT_VERSION,
      app: { name: "x", containers: { api: { image: "nginx" } } },
    });
    expect(req.regionSettings.allowedRegionIds).toEqual([]);
    expect(req.regionSettings.requiredRegionIds).toEqual([]);
  });

  test("defaults autoScaling to { min: 1, max: 1 } when missing", () => {
    const req = configToAddRequest({
      version: CURRENT_VERSION,
      app: { name: "x", containers: { api: { image: "nginx" } } },
    });
    expect(req.autoScaling).toEqual({ min: 1, max: 1 });
  });

  test("passes scaling through when set", () => {
    const req = configToAddRequest({
      version: CURRENT_VERSION,
      app: {
        name: "x",
        scaling: { min: 2, max: 5 },
        containers: { api: { image: "nginx" } },
      },
    });
    expect(req.autoScaling).toEqual({ min: 2, max: 5 });
  });

  test("env record becomes environmentVariables array", () => {
    const req = configToAddRequest({
      version: CURRENT_VERSION,
      app: {
        name: "x",
        containers: {
          api: { image: "nginx", env: { PORT: "3000", DEBUG: "true" } },
        },
      },
    });
    const c = req.containerTemplates?.[0];
    expect(c?.environmentVariables).toEqual([
      { name: "PORT", value: "3000" },
      { name: "DEBUG", value: "true" },
    ]);
  });

  test("cdn endpoint defaults ssl to true and maps port pairs", () => {
    const req = configToAddRequest({
      version: CURRENT_VERSION,
      app: {
        name: "x",
        containers: {
          api: {
            image: "nginx",
            endpoints: [
              { type: "cdn", ports: [{ public: 443, container: 3000 }] },
            ],
          },
        },
      },
    });
    const ep = req.containerTemplates?.[0]?.endpoints?.[0];
    expect(ep?.displayName).toBe("cdn");
    expect(ep?.cdn?.isSslEnabled).toBe(true);
    expect(ep?.cdn?.portMappings).toEqual([
      { containerPort: 3000, exposedPort: 443 },
    ]);
  });

  test("anycast endpoint stamps type 'iPv4'", () => {
    const req = configToAddRequest({
      version: CURRENT_VERSION,
      app: {
        name: "x",
        containers: {
          api: {
            image: "nginx",
            endpoints: [
              { type: "anycast", ports: [{ public: 80, container: 80 }] },
            ],
          },
        },
      },
    });
    const ep = req.containerTemplates?.[0]?.endpoints?.[0];
    expect(ep?.anycast?.type).toBe("iPv4");
    expect(ep?.anycast?.portMappings).toEqual([
      { containerPort: 80, exposedPort: 80 },
    ]);
  });

  test("deduplicates volumes across containers", () => {
    const req = configToAddRequest({
      version: CURRENT_VERSION,
      app: {
        name: "x",
        containers: {
          api: {
            image: "nginx",
            volumes: [{ name: "data", mount: "/data", size: 10 }],
          },
          worker: {
            image: "nginx",
            volumes: [{ name: "data", mount: "/data", size: 10 }],
          },
        },
      },
    });
    expect(req.volumes).toEqual([{ name: "data", size: 10 }]);
    // Volume *mounts* still appear on every container that references the volume.
    expect(req.containerTemplates?.[0]?.volumeMounts).toEqual([
      { name: "data", mountPath: "/data" },
    ]);
    expect(req.containerTemplates?.[1]?.volumeMounts).toEqual([
      { name: "data", mountPath: "/data" },
    ]);
  });

  test("missing image becomes empty string with empty parsed fields", () => {
    const req = configToAddRequest({
      version: CURRENT_VERSION,
      app: {
        name: "x",
        containers: { api: {} },
      },
    });
    const c = req.containerTemplates?.[0];
    expect(c?.image).toBe("");
    expect(c?.imageName).toBe("");
    expect(c?.imageNamespace).toBe("");
    expect(c?.imageRegistryId).toBe("");
  });

  test("command becomes entryPoint.commandArray", () => {
    const req = configToAddRequest({
      version: CURRENT_VERSION,
      app: {
        name: "x",
        containers: {
          api: { image: "nginx", command: ["bash", "-c", "exit 0"] },
        },
      },
    });
    expect(req.containerTemplates?.[0]?.entryPoint).toEqual({
      commandArray: ["bash", "-c", "exit 0"],
    });
  });
});

describe("configToPatchRequest", () => {
  test("first local container inherits id from first remote template even if names differ", () => {
    const existing = app({
      containerTemplates: [template({ id: "ct_remote_1", name: "api-old" })],
    });
    const req = configToPatchRequest(
      {
        version: CURRENT_VERSION,
        app: {
          name: "x",
          containers: { "api-new": { image: "nginx" } },
        },
      },
      existing,
    );
    expect(req.containerTemplates?.[0]?.id).toBe("ct_remote_1");
    expect(req.containerTemplates?.[0]?.name).toBe("api-new");
  });

  test("non-first containers match remote templates by name", () => {
    const existing = app({
      containerTemplates: [
        template({ id: "ct_remote_1", name: "api" }),
        template({ id: "ct_remote_2", name: "db" }),
      ],
    });
    const req = configToPatchRequest(
      {
        version: CURRENT_VERSION,
        app: {
          name: "x",
          containers: {
            api: { image: "ghcr.io/me/api:v2" },
            db: { image: "postgres:17" },
          },
        },
      },
      existing,
    );
    expect(req.containerTemplates?.[0]?.id).toBe("ct_remote_1");
    expect(req.containerTemplates?.[1]?.id).toBe("ct_remote_2");
  });

  test("non-first container with no remote match gets no id", () => {
    const existing = app({
      containerTemplates: [template({ id: "ct_remote_1", name: "api" })],
    });
    const req = configToPatchRequest(
      {
        version: CURRENT_VERSION,
        app: {
          name: "x",
          containers: {
            api: { image: "nginx" },
            sidecar: { image: "busybox" },
          },
        },
      },
      existing,
    );
    expect(req.containerTemplates?.[1]?.id).toBeUndefined();
  });
});
