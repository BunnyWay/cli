import type { Argv, CommandModule } from "yargs";
import { defineCommand } from "../define-command.ts";
import { defineNamespace } from "../define-namespace.ts";
import { UserError } from "../errors.ts";
import { formatTable } from "../format.ts";
import { logger } from "../logger.ts";
import type { GlobalArgs } from "../types.ts";
import { confirm, spinner } from "../ui.ts";
import {
  enableSsl,
  fetchPullZoneHostnames,
  hostnameUrl,
  type ResolvedPullZone,
  toSafeHostname,
} from "./client.ts";

/** Resolves the pull zone (and a core client) for the resource being targeted. */
export type HostnameResolver = (
  args: GlobalArgs & Record<string, unknown>,
) => Promise<ResolvedPullZone>;

export interface HostnamesMountOptions {
  /** Command breadcrumb used in examples and follow-up hints, e.g. "scripts domains". */
  commandPath: string;
  /** Visible namespace name shown in help (defaults to "domains"). */
  namespace?: string;
  /** Resolve the pull zone + core client from the parsed args. */
  resolve: HostnameResolver;
  /** Adds resource-targeting flags (e.g. --id, --pull-zone) shared by every subcommand. */
  target?: (yargs: Argv) => Argv;
  /** Namespace description shown in help. */
  describe?: string;
  /** Hidden namespace aliases (e.g. ["hostnames"]) — they work but stay out of help. */
  hiddenAliases?: string[];
}

/** Strip any scheme and trailing slash from a user-supplied hostname. */
function normalizeHostname(value: string): string {
  return value.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/** Echo back the targeting flags the user passed so copy-paste follow-up hints keep the same scope. */
function targetSuffix(args: Record<string, unknown>): string {
  const parts: string[] = [];
  if (args.id != null) parts.push(`--id ${args.id}`);
  if (args["pull-zone"] != null) parts.push(`--pull-zone ${args["pull-zone"]}`);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

/**
 * Build a reusable `domains` command namespace for any resource backed by a
 * pull zone (Edge Scripts today, Magic Containers apps next). The caller
 * supplies a {@link HostnameResolver} that maps the parsed args to a pull
 * zone; the add/ssl/list/remove behavior is identical across resources.
 *
 * Returns the visible namespace followed by any hidden alias namespaces, ready
 * to spread into a parent namespace's subcommand list.
 */
export function createHostnamesCommands(
  opts: HostnamesMountOptions,
): CommandModule[] {
  const { commandPath, resolve } = opts;
  // Generic passthrough so each subcommand's inferred arg type is preserved.
  const target = <T>(yargs: Argv<T>): Argv<T> =>
    (opts.target ? opts.target(yargs as Argv) : yargs) as Argv<T>;
  const resolveArgs = (args: GlobalArgs) =>
    resolve(args as GlobalArgs & Record<string, unknown>);

  const addCommand = defineCommand<{
    domain: string;
    ssl?: boolean;
    "force-ssl"?: boolean;
  }>({
    command: "add <domain>",
    describe: "Add a custom domain to a pull zone.",
    examples: [
      [`$0 ${commandPath} add shop.example.com`, "Add a domain (no SSL)"],
      [
        `$0 ${commandPath} add shop.example.com --ssl`,
        "Add and request SSL now",
      ],
    ],
    builder: (yargs) =>
      target(
        yargs
          .positional("domain", {
            type: "string",
            describe: "Custom domain to add (e.g. shop.example.com)",
            demandOption: true,
          })
          .option("ssl", {
            type: "boolean",
            describe:
              "Issue a free SSL certificate now and force HTTPS (requires DNS to already point at bunny.net)",
          })
          .option("force-ssl", {
            type: "boolean",
            default: true,
            describe:
              "Force HTTP→HTTPS when issuing SSL (default: true). Use --no-force-ssl to keep HTTP.",
          }),
      ),
    handler: async (args) => {
      const hostname = normalizeHostname(args.domain ?? "");
      if (!hostname) throw new UserError("A domain is required.");

      const requestSsl = args.ssl === true;
      const force = args["force-ssl"] !== false;

      const { pullZoneId, coreClient } = await resolveArgs(args);

      const spin = spinner(`Adding ${hostname}...`);
      spin.start();

      await coreClient.POST("/pullzone/{id}/addHostname", {
        params: { path: { id: pullZoneId } },
        body: { Hostname: hostname },
      });

      const hostnames = await fetchPullZoneHostnames(coreClient, pullZoneId);
      const systemHostname = hostnames
        .find((h) => h.IsSystemHostname)
        ?.Value?.replace(/^https?:\/\//i, "");

      spin.stop();

      let sslIssued = false;
      let sslError: string | undefined;
      if (requestSsl) {
        const sslSpin = spinner("Requesting free SSL certificate...");
        sslSpin.start();
        try {
          await enableSsl(coreClient, pullZoneId, hostname, force, hostnames);
          sslIssued = true;
        } catch (err) {
          sslError = err instanceof Error ? err.message : String(err);
        }
        sslSpin.stop();
      }

      const sslHint = `bunny ${commandPath} ssl ${hostname}${targetSuffix(
        args as unknown as Record<string, unknown>,
      )}`;

      // A requested certificate that failed to issue is a command error, like `ssl`.
      const sslFailed = requestSsl && sslError != null;

      if (args.output === "json") {
        logger.log(
          JSON.stringify(
            {
              hostname,
              pullZoneId,
              cnameTarget: systemHostname ?? null,
              ssl: sslIssued,
              forceSSL: sslIssued && force,
              sslError: sslError ?? null,
            },
            null,
            2,
          ),
        );
        // Emit the full result for agents/CI, then signal failure with a non-zero exit.
        if (sslFailed) process.exit(1);
        return;
      }

      logger.success(`Added ${hostname} to pull zone ${pullZoneId}.`);

      if (sslIssued) {
        logger.log();
        logger.success(
          force
            ? "SSL certificate issued and HTTPS forced."
            : "SSL certificate issued.",
        );
        logger.log(
          `  Live at: ${hostnameUrl(hostname, { hasCertificate: true })}`,
        );
        return;
      }

      if (systemHostname) {
        logger.log();
        logger.log("Point your DNS at bunny.net to activate it:");
        logger.dim(`  CNAME  ${hostname}  →  ${systemHostname}`);
      }

      logger.log();

      if (sslFailed) {
        throw new UserError(
          `Couldn't issue a certificate for ${hostname} yet: ${sslError}`,
          `This is normal until DNS propagates. Once it's live, run: ${sslHint}`,
        );
      }

      logger.log("Then enable HTTPS once DNS is live:");
      logger.dim(`  ${sslHint}`);
    },
  });

  const sslCommand = defineCommand<{
    domain: string;
    "force-ssl"?: boolean;
  }>({
    command: "ssl <domain>",
    describe: "Request a free SSL certificate for a custom domain.",
    examples: [
      [
        `$0 ${commandPath} ssl shop.example.com`,
        "Issue a free certificate and force HTTPS",
      ],
      [
        `$0 ${commandPath} ssl shop.example.com --no-force-ssl`,
        "Issue without forcing HTTPS",
      ],
    ],
    builder: (yargs) =>
      target(
        yargs
          .positional("domain", {
            type: "string",
            describe: "Custom domain to secure (e.g. shop.example.com)",
            demandOption: true,
          })
          .option("force-ssl", {
            type: "boolean",
            default: true,
            describe:
              "Force HTTP→HTTPS after issuing the certificate (default: true). Use --no-force-ssl to keep HTTP.",
          }),
      ),
    handler: async (args) => {
      const hostname = normalizeHostname(args.domain ?? "");
      if (!hostname) throw new UserError("A domain is required.");

      const force = args["force-ssl"] !== false;

      const { pullZoneId, coreClient } = await resolveArgs(args);

      const spin = spinner("Requesting free SSL certificate...");
      spin.start();

      try {
        await enableSsl(coreClient, pullZoneId, hostname, force);
      } catch (err) {
        spin.stop();
        if (err instanceof UserError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw new UserError(
          `Couldn't issue a certificate for ${hostname}: ${message}`,
          "Make sure the domain's DNS points at bunny.net, then try again.",
        );
      }

      spin.stop();

      if (args.output === "json") {
        logger.log(
          JSON.stringify(
            { hostname, pullZoneId, ssl: true, forceSSL: force },
            null,
            2,
          ),
        );
        return;
      }

      logger.success(
        force
          ? `SSL certificate issued for ${hostname} and HTTPS forced.`
          : `SSL certificate issued for ${hostname}.`,
      );
      logger.log(
        `  Live at: ${hostnameUrl(hostname, { hasCertificate: true })}`,
      );
    },
  });

  const listCommand = defineCommand({
    command: "list",
    aliases: ["ls"],
    describe: "List the domains on a pull zone.",
    examples: [
      [`$0 ${commandPath} list`, "List domains"],
      [`$0 ${commandPath} list --output json`, "JSON output"],
    ],
    builder: (yargs) => target(yargs),
    handler: async (args) => {
      const { pullZoneId, coreClient } = await resolveArgs(args);

      const spin = spinner("Fetching hostnames...");
      spin.start();

      const hostnames = await fetchPullZoneHostnames(coreClient, pullZoneId);

      spin.stop();

      if (args.output === "json") {
        logger.log(JSON.stringify(hostnames.map(toSafeHostname), null, 2));
        return;
      }

      if (hostnames.length === 0) {
        logger.info("No domains found.");
        return;
      }

      logger.log(
        formatTable(
          ["Domain", "Type", "SSL", "Force SSL"],
          hostnames.map((h) => [
            hostnameUrl(h.Value ?? "", {
              hasCertificate: h.HasCertificate,
              forceSSL: h.ForceSSL,
            }),
            h.IsSystemHostname ? "System" : "Custom",
            h.HasCertificate ? "Yes" : "No",
            h.ForceSSL ? "Yes" : "No",
          ]),
          args.output,
        ),
      );
    },
  });

  const removeCommand = defineCommand<{
    domain: string;
    force?: boolean;
  }>({
    command: "remove <domain>",
    aliases: ["rm"],
    describe: "Remove a custom domain from a pull zone.",
    examples: [
      [`$0 ${commandPath} remove shop.example.com`, "Remove a custom domain"],
      [
        `$0 ${commandPath} remove shop.example.com --force`,
        "Skip confirmation",
      ],
    ],
    builder: (yargs) =>
      target(
        yargs
          .positional("domain", {
            type: "string",
            describe: "Custom domain to remove",
            demandOption: true,
          })
          .option("force", {
            alias: "f",
            type: "boolean",
            default: false,
            describe: "Skip confirmation prompt",
          }),
      ),
    handler: async (args) => {
      const hostname = normalizeHostname(args.domain ?? "");
      if (!hostname) throw new UserError("A domain is required.");

      const { pullZoneId, coreClient } = await resolveArgs(args);

      const spin = spinner("Fetching hostnames...");
      spin.start();

      const hostnames = await fetchPullZoneHostnames(coreClient, pullZoneId);

      spin.stop();

      const match = hostnames.find(
        (h) => (h.Value ?? "").toLowerCase() === hostname.toLowerCase(),
      );
      if (!match) {
        throw new UserError(
          `Domain "${hostname}" is not on pull zone ${pullZoneId}.`,
        );
      }
      if (match.IsSystemHostname) {
        throw new UserError(
          `"${hostname}" is a bunny.net system hostname and cannot be removed.`,
        );
      }

      const confirmed = await confirm(`Remove ${hostname}?`, {
        force: args.force,
      });
      if (!confirmed) {
        logger.log("Cancelled.");
        return;
      }

      const removeSpin = spinner(`Removing ${hostname}...`);
      removeSpin.start();

      await coreClient.DELETE("/pullzone/{id}/removeHostname", {
        params: { path: { id: pullZoneId } },
        body: { Hostname: hostname },
      });

      removeSpin.stop();

      if (args.output === "json") {
        logger.log(
          JSON.stringify({ hostname, pullZoneId, removed: true }, null, 2),
        );
        return;
      }

      logger.success(`Removed ${hostname}.`);
    },
  });

  const subcommands = [addCommand, sslCommand, listCommand, removeCommand];
  const describe = opts.describe ?? "Manage custom domains.";
  const namespace = opts.namespace ?? "domains";

  return [
    defineNamespace(namespace, describe, subcommands),
    ...(opts.hiddenAliases ?? []).map((alias) =>
      defineNamespace(alias, false, subcommands),
    ),
  ];
}
