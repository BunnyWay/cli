import type { components } from "@bunny.net/openapi-client/generated/magic-containers.d.ts";
import prompts from "prompts";
import type { ContainerConfig } from "./config.ts";

type EndpointRequest = components["schemas"]["EndpointRequest"];
type EnvironmentVariableSuggestion =
  components["schemas"]["EnvironmentVariableSuggestion"];

/**
 * Prompt the user to accept/reject each suggested endpoint.
 *
 * Suggestions come from two places:
 * - `getConfigSuggestions` (`POST /registries/config-suggestions`) for
 *   pre-built and just-pushed images - bunny.net's own analysis,
 *   richer than what we can derive locally.
 * - The Dockerfile EXPOSE parser in `docker.ts`, used as a fallback
 *   when the API doesn't return suggestions (e.g. `--no-push` runs).
 */
export async function confirmEndpointSuggestions(
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

export function describeEndpoint(ep: EndpointRequest): string {
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

export function endpointRequestToConfig(
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

/**
 * Container ports already present in a `ContainerConfig`'s endpoint
 * list. Used to filter API-suggested endpoints down to "ports the user
 * hasn't already configured" so we don't double-prompt.
 */
export function containerPortsInConfig(
  container: ContainerConfig,
): Set<number> {
  const ports = new Set<number>();
  for (const ep of container.endpoints ?? []) {
    for (const p of ep.ports ?? []) {
      ports.add(p.container);
    }
  }
  return ports;
}

/** Container ports a suggested EndpointRequest targets. */
export function endpointContainerPorts(ep: EndpointRequest): number[] {
  if (ep.cdn) {
    return (ep.cdn.portMappings ?? []).map((p) => p.containerPort);
  }
  if (ep.anycast) {
    return ep.anycast.portMappings.map((p) => p.containerPort);
  }
  return [];
}

/**
 * Filter endpoint suggestions to only those targeting container ports
 * not already configured. Suggestions hitting an already-configured
 * port are dropped silently - the user's choice stands.
 */
export function filterNewEndpointSuggestions(
  suggestions: EndpointRequest[],
  container: ContainerConfig,
): EndpointRequest[] {
  const configured = containerPortsInConfig(container);
  return suggestions.filter((ep) => {
    const ports = endpointContainerPorts(ep);
    return ports.length === 0 || ports.some((p) => !configured.has(p));
  });
}

/**
 * Prompt the user for the values of suggested env vars. Required
 * suggestions always prompt; optional ones are gated behind a
 * "configure now?" confirmation so a long list doesn't ambush users.
 */
export async function promptSuggestedEnv(
  suggestions: EnvironmentVariableSuggestion[],
): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  const required = suggestions.filter((s) => s.required);
  const optional = suggestions.filter((s) => !s.required);

  for (const item of required) {
    if (!item.name) continue;
    const { value } = await prompts({
      type: "text",
      name: "value",
      message: `${item.name}${item.description ? ` (${item.description})` : ""}:`,
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
          message: `${item.name}${item.description ? ` (${item.description})` : ""}:`,
          initial: item.defaultValue ?? "",
        });
        if (value !== undefined && value !== "") env[item.name] = String(value);
      }
    }
  }

  return env;
}

/**
 * Filter env suggestions to only those whose names aren't already set
 * in the container config. Avoids prompting for values the user
 * already wrote into bunny.jsonc.
 */
export function filterNewEnvSuggestions(
  suggestions: EnvironmentVariableSuggestion[],
  container: ContainerConfig,
): EnvironmentVariableSuggestion[] {
  const existing = new Set(Object.keys(container.env ?? {}));
  return suggestions.filter((s) => s.name && !existing.has(s.name));
}
