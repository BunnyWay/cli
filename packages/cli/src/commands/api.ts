import { defineCommand } from "../core/define-command.ts";
import { resolveConfig } from "../config/index.ts";
import { logger } from "../core/logger.ts";
import { UserError } from "../core/errors.ts";
import { VERSION } from "../core/version.ts";

const BASE_URL = "https://api.bunny.net";

const COMMAND = "api <method> [path]";
const DESCRIPTION = "Make a raw API request to bunny.net.";

const VALID_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

interface ApiArgs {
  method: string;
  path?: string;
  body?: string;
}

/**
 * Make a raw authenticated HTTP request to the bunny.net API.
 *
 * A convenient low-level way to call any bunny.net API endpoint.
 * Auth is handled automatically via your configured API key.
 *
 * @example
 * ```bash
 * # List pull zones
 * bunny api GET /pullzone
 *
 * # List databases
 * bunny api GET /database/v2/databases
 *
 * # Create a database
 * bunny api POST /database/v2/databases --body '{"name":"test","storage_region":"DE","primary_regions":["DE"]}'
 *
 * # Delete a resource
 * bunny api DELETE /dnszone/12345
 *
 * # Pipe body from stdin
 * echo '{"name":"test"}' | bunny api POST /database/v2/databases
 * ```
 */
export const apiCommand = defineCommand<ApiArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 api GET /pullzone", "List pull zones"],
    ["$0 api GET /database/v2/databases", "List databases"],
    ["$0 api POST /database/v2/databases --body '{\"name\":\"test\"}'", "Create with JSON body"],
  ],

  builder: (yargs) =>
    yargs
      .positional("method", {
        type: "string",
        describe: "HTTP method (GET, POST, PUT, PATCH, DELETE)",
        demandOption: true,
      })
      .positional("path", {
        type: "string",
        describe: "API endpoint path (e.g. /pullzone)",
      })
      .option("body", {
        alias: "b",
        type: "string",
        describe: "JSON request body",
      }),

  handler: async ({ method: rawMethod, path, body: bodyFlag, profile, output, verbose, apiKey }) => {
    const method = rawMethod.toUpperCase();
    if (!VALID_METHODS.includes(method as any)) {
      throw new UserError(
        `Invalid method: ${rawMethod}`,
        `Use one of: ${VALID_METHODS.join(", ")}`,
      );
    }

    if (!path) {
      throw new UserError(
        "Path is required.",
        "Example: bunny api GET /pullzone",
      );
    }

    const config = resolveConfig(profile, apiKey);
    if (!config.apiKey) {
      throw new UserError("Not logged in.", 'Run "bunny login" to authenticate.');
    }

    const baseUrl = config.apiUrl ?? BASE_URL;
    const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

    // Body: --body flag, or read from stdin if not a TTY
    let requestBody: string | undefined = bodyFlag;
    if (!requestBody && !process.stdin.isTTY && method !== "GET") {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      const stdin = Buffer.concat(chunks).toString("utf-8").trim();
      if (stdin) requestBody = stdin;
    }

    if (requestBody) {
      // Validate JSON
      try {
        JSON.parse(requestBody);
      } catch {
        throw new UserError("Invalid JSON body.", "Ensure --body contains valid JSON.");
      }
    }

    const headers: Record<string, string> = {
      AccessKey: config.apiKey,
      "User-Agent": `bunny-cli/${VERSION}`,
      Accept: "application/json",
    };

    if (requestBody) {
      headers["Content-Type"] = "application/json";
    }

    if (verbose) {
      logger.debug(`→ ${method} ${url}`, true);
      if (requestBody) logger.debug(`→ Body: ${requestBody}`, true);
    }

    const res = await fetch(url, {
      method,
      headers,
      body: requestBody,
    });

    if (verbose) {
      logger.debug(`← ${res.status} ${res.statusText}`, true);
    }

    const text = await res.text();

    // Try to parse and pretty-print JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON — output raw
      if (!res.ok) {
        throw new UserError(`${res.status} ${res.statusText}`, text || undefined);
      }
      if (text) logger.log(text);
      return;
    }

    if (!res.ok) {
      if (output === "json") {
        logger.log(JSON.stringify({ error: parsed, status: res.status }, null, 2));
      } else {
        const msg = typeof parsed === "object" && parsed !== null
          ? (parsed as any).detail ?? (parsed as any).Message ?? (parsed as any).title ?? `${res.status} ${res.statusText}`
          : `${res.status} ${res.statusText}`;
        throw new UserError(msg);
      }
      process.exit(1);
    }

    logger.log(JSON.stringify(parsed, null, 2));
  },
});
