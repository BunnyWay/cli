import type { Argv, CommandModule } from "yargs";
import { defineCommand } from "../define-command.ts";
import { defineNamespace } from "../define-namespace.ts";
import { UserError } from "../errors.ts";
import { formatTable } from "../format.ts";
import { logger } from "../logger.ts";
import type { GlobalArgs } from "../types.ts";
import { confirm, isInteractive, requireConfirmable, spinner } from "../ui.ts";
import {
  addHostname,
  type CoreClient,
  enableSsl,
  fetchPullZoneHostnames,
  hostnameUrl,
  normalizeHostname,
  type ResolvedPullZone,
  toSafeHostname,
} from "./client.ts";
import {
  offerBunnyDnsThenSsl,
  offerDnsWaitAndSsl,
  printSslHint,
} from "./flow.ts";

/** Resolves the pull zone (and a core client) for the resource being targeted. */
export type HostnameResolver = (
  args: GlobalArgs & Record<string, unknown>,
) => Promise<ResolvedPullZone>;

/** Context passed to the {@link HostnamesMountOptions.onAdded}/`onRemoved` hooks. */
export interface HostnameHookContext {
  coreClient: CoreClient;
  pullZoneId: number;
  hostname: string;
  /** The zone's system hostname: the CNAME target (add only). */
  cnameTarget?: string;
  args: GlobalArgs & Record<string, unknown>;
}

export interface HostnamesMountOptions {
  /** Command breadcrumb used in examples and follow-up hints, e.g. "scripts domains". */
  commandPath: string;
  /** Visible namespace name shown in help (defaults to "domains"). */
  namespace?: string;
  /** Resolve the pull zone + core client from the parsed args. */
  resolve: HostnameResolver;
  /** Adds resource-targeting flags (e.g. --id, --pull-zone) shared by every subcommand. */
  target?: (yargs: Argv) => Argv;
  /** Optional trailing positional (e.g. `[id]`) appended to every subcommand for targeting the resource. */
  targetPositional?: {
    name: string;
    describe: string;
    type?: "string" | "number";
  };
  /** Namespace description shown in help. */
  describe?: string;
  /** Hidden namespace aliases (e.g. ["hostnames"]) — they work but stay out of help. */
  hiddenAliases?: string[];
  /**
   * Runs after a domain is added (before the SSL/DNS follow-up); lets a
   * resource attach companion hostnames or persist the domain. The hook must
   * handle its own errors; a companion failure shouldn't fail the add.
   */
  onAdded?: (ctx: HostnameHookContext) => Promise<void>;
  /** Runs after a domain is removed; the counterpart of {@link onAdded}. */
  onRemoved?: (ctx: HostnameHookContext) => Promise<void>;
}

/** Echo back the targeting args the user passed so copy-paste follow-up hints keep the same scope. */
export function targetSuffix(
  args: Record<string, unknown>,
  positionalName?: string,
): string {
  const parts: string[] = [];
  // The trailing positional (storage zone, or script id) re-targets the resource.
  if (positionalName && args[positionalName] != null) {
    parts.push(String(args[positionalName]));
  }
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
  const { commandPath, resolve, targetPositional } = opts;
  // Append the targeting positional (e.g. "[id]") to a subcommand's command string.
  const command = (base: string) =>
    targetPositional ? `${base} [${targetPositional.name}]` : base;
  // Generic passthrough so each subcommand's inferred arg type is preserved.
  const target = <T>(yargs: Argv<T>): Argv<T> => {
    const withPositional = targetPositional
      ? yargs.positional(targetPositional.name, {
          type: targetPositional.type ?? "number",
          describe: targetPositional.describe,
        })
      : yargs;
    return (
      opts.target ? opts.target(withPositional as Argv) : withPositional
    ) as Argv<T>;
  };
  const resolveArgs = (args: GlobalArgs) =>
    resolve(args as GlobalArgs & Record<string, unknown>);

  const addCommand = defineCommand<{
    domain: string;
    ssl?: boolean;
    "force-ssl"?: boolean;
    wait?: boolean;
  }>({
    command: command("add <domain>"),
    describe: "Add a custom domain to a pull zone.",
    examples: [
      [`$0 ${commandPath} add shop.example.com`, "Add a domain (no SSL)"],
      [
        `$0 ${commandPath} add shop.example.com --ssl`,
        "Add and request SSL now",
      ],
      [
        `$0 ${commandPath} add shop.example.com --wait`,
        "Add, wait for DNS, then enable HTTPS",
      ],
      ...(targetPositional
        ? ([
            [
              `$0 ${commandPath} add shop.example.com 12345`,
              `Target an explicit ${targetPositional.name}`,
            ],
          ] as const)
        : []),
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
          })
          .option("wait", {
            type: "boolean",
            describe:
              "Wait for DNS to point at bunny.net (up to 10 minutes), then issue SSL automatically",
          }),
      ),
    handler: async (args) => {
      const hostname = normalizeHostname(args.domain ?? "");
      if (!hostname) throw new UserError("A domain is required.");

      const requestSsl = args.ssl === true;
      const force = args["force-ssl"] !== false;
      const interactive = isInteractive(args.output);

      const { pullZoneId, coreClient } = await resolveArgs(args);

      const spin = spinner(`Adding ${hostname}...`);
      spin.start();

      const { hostnames, cnameTarget: systemHostname } = await addHostname(
        coreClient,
        pullZoneId,
        hostname,
      );

      spin.stop();

      if (opts.onAdded) {
        await opts.onAdded({
          coreClient,
          pullZoneId,
          hostname,
          cnameTarget: systemHostname,
          args: args as unknown as GlobalArgs & Record<string, unknown>,
        });
      }

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
        targetPositional?.name,
      )}`;

      // A requested certificate that failed to issue is a command error, like `ssl`.
      const sslFailed = requestSsl && sslError != null;

      if (args.output === "json") {
        // With --wait, finish the DNS/SSL flow first so the JSON reflects the real certificate outcome.
        if (systemHostname && args.wait === true && !sslIssued) {
          try {
            sslIssued = await offerDnsWaitAndSsl({
              coreClient,
              pullZoneId,
              hostname,
              cnameTarget: systemHostname,
              forceSsl: force,
              sslHint,
              assumeYes: true,
              json: true,
            });
            if (sslIssued) sslError = undefined;
          } catch (err) {
            sslError = err instanceof Error ? err.message : String(err);
          }
        }

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
        const sslWanted =
          requestSsl || (args.wait === true && systemHostname != null);
        if (sslWanted && !sslIssued) process.exit(1);
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

      // Offer to wait for DNS and finish HTTPS in one go (or just do it with --wait).
      const offerWait =
        systemHostname != null && (args.wait === true || interactive);

      if (sslFailed && offerWait) {
        logger.warn(`Couldn't issue a certificate yet: ${sslError}`);
        logger.dim("  This is normal until DNS propagates.");
      }

      // If the domain is on Bunny DNS, offer to add the record (prompted) so SSL can issue right away.
      if (systemHostname && interactive) {
        const issued = await offerBunnyDnsThenSsl({
          coreClient,
          hostname,
          pullZoneId,
          cnameTarget: systemHostname,
          forceSsl: force,
          sslHint,
          verbose: args.verbose,
        });
        if (issued !== null) return;
      }

      if (systemHostname) {
        logger.log();
        logger.log("Point your DNS at bunny.net to activate it:");
        logger.accent(`  CNAME  ${hostname}  →  ${systemHostname}`);
      }

      logger.log();

      if (systemHostname && offerWait) {
        await offerDnsWaitAndSsl({
          coreClient,
          pullZoneId,
          hostname,
          cnameTarget: systemHostname,
          forceSsl: force,
          sslHint,
          assumeYes: args.wait === true,
        });
        return;
      }

      if (sslFailed) {
        throw new UserError(
          `Couldn't issue a certificate for ${hostname} yet: ${sslError}`,
          `This is normal until DNS propagates. Once it's live, run: ${sslHint}`,
        );
      }

      printSslHint(sslHint);
    },
  });

  const sslCommand = defineCommand<{
    domain: string;
    "force-ssl"?: boolean;
  }>({
    command: command("ssl <domain>"),
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
    command: command("list"),
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
    command: command("remove <domain>"),
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

      requireConfirmable(args.output, {
        force: args.force,
        message: `Removing ${hostname} needs a confirmation prompt.`,
        hint: "Re-run with --force to remove it non-interactively.",
      });
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

      if (opts.onRemoved) {
        await opts.onRemoved({
          coreClient,
          pullZoneId,
          hostname,
          args: args as unknown as GlobalArgs & Record<string, unknown>,
        });
      }

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
