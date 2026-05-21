import { describe, expect, test } from "bun:test";
import type { components } from "@bunny.net/openapi-client/generated/magic-containers.d.ts";
import {
  containerPortsInConfig,
  endpointContainerPorts,
  endpointRequestToConfig,
  filterNewEndpointSuggestions,
  filterNewEnvSuggestions,
} from "./suggestions.ts";

type EndpointRequest = components["schemas"]["EndpointRequest"];

const cdn = (...ports: Array<[number, number]>): EndpointRequest => ({
  displayName: "cdn",
  cdn: {
    isSslEnabled: true,
    portMappings: ports.map(([exposed, container]) => ({
      exposedPort: exposed,
      containerPort: container,
    })),
  },
});

describe("endpointContainerPorts", () => {
  test("extracts container ports from a CDN endpoint", () => {
    expect(endpointContainerPorts(cdn([443, 8080], [80, 8080]))).toEqual([
      8080, 8080,
    ]);
  });

  test("returns [] for an endpoint with no portMappings", () => {
    expect(endpointContainerPorts({ displayName: "weird" })).toEqual([]);
  });
});

describe("containerPortsInConfig", () => {
  test("collects container ports across all endpoints", () => {
    const ports = containerPortsInConfig({
      endpoints: [
        { type: "cdn", ports: [{ public: 443, container: 8080 }] },
        { type: "anycast", ports: [{ public: 9090, container: 9090 }] },
      ],
    });
    expect([...ports]).toEqual([8080, 9090]);
  });

  test("returns empty Set when no endpoints", () => {
    expect(containerPortsInConfig({}).size).toBe(0);
  });
});

describe("filterNewEndpointSuggestions", () => {
  test("drops suggestions whose container port is already configured", () => {
    const out = filterNewEndpointSuggestions(
      [cdn([443, 8080]), cdn([443, 9090])],
      {
        endpoints: [{ type: "cdn", ports: [{ public: 443, container: 8080 }] }],
      },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.cdn?.portMappings?.[0]?.containerPort).toBe(9090);
  });

  test("keeps all suggestions when the config has no endpoints", () => {
    const suggestions = [cdn([443, 8080]), cdn([80, 3000])];
    const out = filterNewEndpointSuggestions(suggestions, {});
    expect(out).toHaveLength(2);
  });

  test("keeps suggestions targeting at least one unconfigured port", () => {
    // suggestion publishes both 8080 (already configured) and 9090 (new)
    const out = filterNewEndpointSuggestions([cdn([443, 8080], [80, 9090])], {
      endpoints: [{ type: "cdn", ports: [{ public: 443, container: 8080 }] }],
    });
    expect(out).toHaveLength(1);
  });
});

describe("filterNewEnvSuggestions", () => {
  test("drops suggestions whose name is already set in config.env", () => {
    const out = filterNewEnvSuggestions(
      [
        { name: "PORT", required: true },
        { name: "LOG_LEVEL", required: false },
      ],
      { env: { PORT: "8080" } },
    );
    expect(out).toEqual([{ name: "LOG_LEVEL", required: false }]);
  });

  test("keeps everything when config.env is empty", () => {
    const sugg = [
      { name: "FOO", required: true },
      { name: "BAR", required: false },
    ];
    expect(filterNewEnvSuggestions(sugg, {})).toEqual(sugg);
  });

  test("drops nameless suggestions", () => {
    expect(filterNewEnvSuggestions([{ required: true }], {})).toEqual([]);
  });
});

describe("endpointRequestToConfig", () => {
  test("converts a CDN request to ContainerConfig endpoint shape", () => {
    expect(endpointRequestToConfig(cdn([443, 8080]))).toEqual({
      type: "cdn",
      ssl: true,
      ports: [{ public: 443, container: 8080 }],
    });
  });

  test("converts an Anycast request", () => {
    const ep: EndpointRequest = {
      displayName: "anycast",
      anycast: {
        type: "iPv4",
        portMappings: [{ exposedPort: 9090, containerPort: 9090 }],
      },
    };
    expect(endpointRequestToConfig(ep)).toEqual({
      type: "anycast",
      ports: [{ public: 9090, container: 9090 }],
    });
  });

  test("falls back to an empty CDN endpoint for malformed input", () => {
    expect(endpointRequestToConfig({ displayName: "weird" })).toEqual({
      type: "cdn",
    });
  });
});
