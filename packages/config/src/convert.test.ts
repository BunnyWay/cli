import { describe, expect, test } from "bun:test";
import type { components } from "@bunny.net/openapi-client/generated/magic-containers.d.ts";
import { configToPatchRequest } from "./convert.ts";
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

  test("no env block carries over the existing template's vars", () => {
    const existing = app({
      containerTemplates: [
        template({
          id: "ct_remote_1",
          name: "api",
          environmentVariables: [{ name: "FOO", value: "bar" }],
        }),
      ],
    });
    const req = configToPatchRequest(
      {
        version: CURRENT_VERSION,
        app: { name: "x", containers: { api: { image: "nginx" } } },
      },
      existing,
    );
    expect(req.containerTemplates?.[0]?.environmentVariables).toEqual([
      { name: "FOO", value: "bar" },
    ]);
  });

  test("env block in config replaces the existing template's vars", () => {
    const existing = app({
      containerTemplates: [
        template({
          id: "ct_remote_1",
          name: "api",
          environmentVariables: [{ name: "FOO", value: "bar" }],
        }),
      ],
    });
    const req = configToPatchRequest(
      {
        version: CURRENT_VERSION,
        app: {
          name: "x",
          containers: { api: { image: "nginx", env: { BAZ: "qux" } } },
        },
      },
      existing,
    );
    expect(req.containerTemplates?.[0]?.environmentVariables).toEqual([
      { name: "BAZ", value: "qux" },
    ]);
  });

  test("empty env block clears the existing template's vars", () => {
    const existing = app({
      containerTemplates: [
        template({
          id: "ct_remote_1",
          name: "api",
          environmentVariables: [{ name: "FOO", value: "bar" }],
        }),
      ],
    });
    const req = configToPatchRequest(
      {
        version: CURRENT_VERSION,
        app: {
          name: "x",
          containers: { api: { image: "nginx", env: {} } },
        },
      },
      existing,
    );
    expect(req.containerTemplates?.[0]?.environmentVariables).toEqual([]);
  });
});
