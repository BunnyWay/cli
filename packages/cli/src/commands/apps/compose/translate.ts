import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type {
  BunnyAppConfig,
  ContainerConfig,
  EndpointConfig,
  ProbeConfig,
  VolumeConfig,
} from "@bunny.net/app-config";
import { CURRENT_VERSION } from "@bunny.net/app-config";
import { UserError } from "../../../core/errors.ts";
import { parseDotenv } from "../env/parse.ts";
import { parsePortMapping } from "./ports.ts";
import type { ComposeFile, ComposeService } from "./schema.ts";

export interface TranslateOptions {
  /** Absolute path of the compose file. Used to resolve env_file and build context paths. */
  composeFilePath: string;
  /** App name (compose has no app-level name, so the caller supplies it). */
  appName: string;
  /** Regions (caller supplies; compose has nothing region-aware). */
  regions: string[];
  /** Registry to assign to every container. Caller picks one in the walkthrough. */
  defaultRegistryId?: string;
}

export interface TranslateResult {
  config: BunnyAppConfig;
  /** Non-fatal warnings to surface, usually about ignored compose fields. */
  warnings: string[];
}

// Compose fields that have no meaning on Magic Containers. We emit a
// warning and skip them. Anything else passes through unchanged.
const IGNORED_FIELDS: Record<string, string> = {
  depends_on: "MC starts all containers together",
  networks: "MC containers share localhost within an app",
  links: "use service names (links are deprecated in compose anyway)",
  external_links: "MC does not link to external Docker containers",
  labels:
    "use bunny.jsonc endpoints for routing instead of Caddy/Traefik labels",
  restart: "MC restarts containers automatically",
  profiles: "compose profiles do not apply on MC",
  deploy:
    "use app.scaling in bunny.jsonc. Compose deploy.replicas is per-service; MC scales the whole app",
};

// Fields we refuse to translate.
const REFUSED_FIELDS: Record<string, string> = {
  extends: "compose `extends:` is not supported. Flatten the service inline.",
  secrets:
    "compose `secrets:` is not supported. Store secrets via `bunny apps env push` instead.",
  configs:
    "compose `configs:` is not supported. Bake config into the image or pass via env.",
};

/**
 * Translate a parsed compose file into a `bunny.jsonc` shape.
 *
 * Returns `{ config, warnings }`. Hard errors (bind mounts, `extends:`,
 * `secrets:`, multi-port ranges) throw `UserError`.
 */
export function composeToConfig(
  compose: ComposeFile,
  opts: TranslateOptions,
): TranslateResult {
  const warnings: string[] = [];
  const containers: Record<string, ContainerConfig> = {};

  const composeDir = dirname(opts.composeFilePath);
  const topLevelVolumes = compose.volumes ?? {};

  for (const [name, service] of Object.entries(compose.services)) {
    const container = translateService(service, name, {
      composeDir,
      defaultRegistryId: opts.defaultRegistryId,
      topLevelVolumes,
      warnings,
    });
    containers[name] = container;
  }

  if (Object.keys(containers).length === 0) {
    throw new UserError(
      "Compose file has no services.",
      "Add at least one service under `services:`.",
    );
  }

  return {
    config: {
      version: CURRENT_VERSION,
      app: {
        name: opts.appName,
        scaling: { min: 1, max: 1 },
        regions: opts.regions,
        containers,
      },
    },
    warnings,
  };
}

interface ServiceCtx {
  composeDir: string;
  defaultRegistryId?: string;
  topLevelVolumes: Record<string, unknown>;
  warnings: string[];
}

function translateService(
  service: ComposeService,
  name: string,
  ctx: ServiceCtx,
): ContainerConfig {
  const container: ContainerConfig = {};

  // Catch refused fields first, so we fail before partially translating.
  for (const [field, reason] of Object.entries(REFUSED_FIELDS)) {
    if ((service as Record<string, unknown>)[field] !== undefined) {
      throw new UserError(
        `Service "${name}" uses unsupported compose field \`${field}\`.`,
        reason,
      );
    }
  }

  // Image / build.
  if (service.image) {
    container.image = service.image;
  }
  if (service.build !== undefined) {
    if (typeof service.build === "string") {
      container.context = service.build;
      container.dockerfile = "Dockerfile";
    } else {
      if (service.build.context) container.context = service.build.context;
      container.dockerfile = service.build.dockerfile ?? "Dockerfile";
      if (service.build.args && Object.keys(service.build.args).length > 0) {
        ctx.warnings.push(
          `Service "${name}": \`build.args\` are not propagated through the deploy flow yet. Bake required ARGs into the Dockerfile or expose them as env.`,
        );
      }
    }
  }
  if (!container.image && !container.dockerfile) {
    throw new UserError(
      `Service "${name}" has neither \`image\` nor \`build\`.`,
      "Add one or the other.",
    );
  }

  // Registry default.
  if (ctx.defaultRegistryId) {
    container.registry = ctx.defaultRegistryId;
  }

  // Command.
  if (service.command !== undefined) {
    container.command =
      typeof service.command === "string"
        ? service.command.trim().split(/\s+/)
        : service.command;
  }

  // Environment: env_file first, then `environment:` overrides per the spec.
  //
  // env_file entries become pointers — only the *keys* go into bunny.jsonc
  // (`"K": "K"`), so the values stay in `.env` (which is gitignored) and
  // get resolved at deploy time. `environment:` values are inline literals
  // and copy as-is; if a key appears in both, the literal wins.
  const env: Record<string, string> = {};
  if (service.env_file !== undefined) {
    const files = Array.isArray(service.env_file)
      ? service.env_file
      : [service.env_file];
    for (const file of files) {
      const path = isAbsolute(file) ? file : resolve(ctx.composeDir, file);
      if (!existsSync(path)) {
        throw new UserError(
          `Service "${name}": env_file \`${file}\` not found at ${path}.`,
        );
      }
      const fileVars = parseDotenv(readFileSync(path, "utf-8"));
      for (const key of Object.keys(fileVars)) {
        env[key] = key;
      }
    }
  }
  if (service.environment !== undefined) {
    Object.assign(env, normalizeEnvironment(service.environment));
  }
  if (Object.keys(env).length > 0) container.env = env;

  // Ports → endpoints. Combine all into one CDN endpoint with multiple
  // mappings, matching how MC's CDN endpoint model accepts them.
  if (service.ports && service.ports.length > 0) {
    const mappings = service.ports.map((p) =>
      parsePortMapping(
        p as string | { target: number; published?: number | string },
      ),
    );
    const endpoint: EndpointConfig = {
      type: "cdn",
      ssl: true,
      ports: mappings,
    };
    container.endpoints = [endpoint];
  }

  // Volumes: named volumes only. Bind mounts are a hard error so users
  // notice rather than silently losing data.
  if (service.volumes && service.volumes.length > 0) {
    const volumes: VolumeConfig[] = [];
    for (const entry of service.volumes) {
      const parsed = parseVolumeEntry(entry, name, ctx.topLevelVolumes);
      if (parsed) volumes.push(parsed);
    }
    if (volumes.length > 0) container.volumes = volumes;
  }

  // Healthcheck → liveness probe.
  if (service.healthcheck && !service.healthcheck.disable) {
    const probe = translateHealthcheck(service.healthcheck);
    if (probe) container.probes = { liveness: probe };
  }

  // Standard ignored-field warnings.
  for (const [field, reason] of Object.entries(IGNORED_FIELDS)) {
    if ((service as Record<string, unknown>)[field] !== undefined) {
      ctx.warnings.push(`Service "${name}": ignored \`${field}\` (${reason}).`);
    }
  }

  return container;
}

function normalizeEnvironment(
  env: Record<string, string | number | boolean | null> | string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(env)) {
    // "KEY=value" or bare "KEY" (inherit from host: not portable, skip)
    for (const line of env) {
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq);
      out[key] = line.slice(eq + 1);
    }
  } else {
    for (const [key, value] of Object.entries(env)) {
      if (value === null) continue;
      out[key] = String(value);
    }
  }
  return out;
}

function parseVolumeEntry(
  entry: string | { type: string; source?: string; target: string },
  serviceName: string,
  topLevelVolumes: Record<string, unknown>,
): VolumeConfig | null {
  if (typeof entry === "object") {
    if (entry.type === "bind") {
      throw new UserError(
        `Service "${serviceName}": bind mount to \`${entry.source}\` is not supported on MC.`,
        "Convert to a named volume (declared under top-level `volumes:`) or remove the mount.",
      );
    }
    if (entry.type === "volume" && entry.source) {
      return {
        name: entry.source,
        mount: entry.target,
        size: sizeForVolume(entry.source, topLevelVolumes),
      };
    }
    throw new UserError(
      `Service "${serviceName}": cannot translate volume entry ${JSON.stringify(entry)}.`,
    );
  }

  // String form: "source:target[:mode]"
  const parts = entry.split(":");
  if (parts.length < 2) {
    // Anonymous volume like "/data" is ambiguous; refuse.
    throw new UserError(
      `Service "${serviceName}": anonymous volume \`${entry}\` is not supported.`,
      "Give the volume a name in top-level `volumes:` and reference it as `name:/path`.",
    );
  }

  const source = parts[0] ?? "";
  const target = parts[1] ?? "";

  // Bind mount heuristic: anything starting with `.` or `/` (or a Windows
  // drive letter, ignored here) is treated as a host path.
  if (source.startsWith(".") || source.startsWith("/")) {
    throw new UserError(
      `Service "${serviceName}": bind mount \`${entry}\` is not supported on MC.`,
      "Convert to a named volume (declared under top-level `volumes:`) or remove the mount.",
    );
  }

  return {
    name: source,
    mount: target,
    size: sizeForVolume(source, topLevelVolumes),
  };
}

/**
 * Compose doesn't carry a size for volumes; they're created on demand
 * by the local docker daemon at whatever size. MC requires GiB in [1, 100].
 * Default to 1 GiB and let users edit `bunny.jsonc` if they want more.
 */
const DEFAULT_VOLUME_SIZE = 1;
function sizeForVolume(
  name: string,
  topLevelVolumes: Record<string, unknown>,
): number {
  // Future hook: read driver_opts.size or similar if anyone uses them.
  void topLevelVolumes;
  void name;
  return DEFAULT_VOLUME_SIZE;
}

function translateHealthcheck(
  hc: NonNullable<ComposeService["healthcheck"]>,
): ProbeConfig | null {
  const test = hc.test;
  if (!test) return null;

  // `test` is either a string (run in a shell) or array form ["CMD", ...] / ["CMD-SHELL", ...].
  const args = Array.isArray(test) ? test : ["CMD-SHELL", test];
  const isCmd = args[0] === "CMD" || args[0] === "CMD-SHELL";
  const body = isCmd ? args.slice(1).join(" ") : args.join(" ");

  // Heuristic: if the command looks like a curl/wget probe of an HTTP URL,
  // emit an http probe with the path extracted. Otherwise fall back to tcp.
  const urlMatch = body.match(/https?:\/\/[^\s]+/);
  if (urlMatch?.[0]) {
    try {
      const url = new URL(urlMatch[0]);
      const portFromUrl = url.port ? Number.parseInt(url.port, 10) : undefined;
      return {
        type: "http",
        path: url.pathname || "/",
        ...(portFromUrl ? { port: portFromUrl } : {}),
      };
    } catch {
      // fall through
    }
  }
  return { type: "tcp" };
}
