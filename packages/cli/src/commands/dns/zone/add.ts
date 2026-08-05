import { createCoreClient } from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import {
  checkDelegation,
  expectedNameservers,
} from "../../../core/dns-nameservers.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { detectRegistrar } from "../../../core/registrar.ts";
import { isInteractive, spinner } from "../../../core/ui.ts";
import { type CoreClient, type DnsZoneModel, fetchZone } from "../api.ts";
import { addRecordInteractive } from "../record/add.ts";
import { importZoneFile } from "../record/import.ts";
import { discoverImportableRecords } from "../record/scan-records.ts";
import { reviewAndApply, writeRecords } from "../record/write.ts";

interface ZoneAddArgs {
  domain?: string;
  import?: boolean;
}

async function scanAndImport(opts: {
  client: CoreClient;
  zone: DnsZoneModel;
  domain: string;
  assumeYes: boolean;
}): Promise<void> {
  let discovered: Awaited<ReturnType<typeof discoverImportableRecords>> = [];
  let scanError: unknown;
  let zone = opts.zone;
  const scanSpin = spinner("Scanning for existing DNS records...");
  scanSpin.start();
  try {
    // Re-fetch the zone so records added earlier in the menu aren't offered (and written) again.
    try {
      zone = await fetchZone(opts.client, opts.zone.Id as number);
    } catch {}
    discovered = await discoverImportableRecords(opts.client, zone);
  } catch (err) {
    scanError = err;
  } finally {
    scanSpin.stop();
  }

  logger.log("");
  if (scanError) {
    logger.warn(
      `Couldn't scan for existing records: ${scanError instanceof Error ? scanError.message : String(scanError)}`,
    );
  } else if (discovered.length) {
    await reviewAndApply({
      client: opts.client,
      zone,
      records: discovered,
      // Callers are always in an interactive text flow; table/csv/markdown must still get the review multiselect.
      output: "text",
      selectMessage: `Found ${discovered.length} existing record(s) for ${opts.domain} at your current provider. Select which to import:`,
      spinnerLabel: "Importing records...",
      successFor: (n) => `Imported ${n} record(s) into ${opts.domain}.`,
      assumeYes: opts.assumeYes,
    });
  } else {
    logger.info(`No existing records found for ${opts.domain}.`);
  }
}

/** After creating the zone, let the user populate it (scan/upload/manual) until they continue to nameserver setup. */
async function offerNextSteps(opts: {
  client: CoreClient;
  config: ReturnType<typeof resolveConfig>;
  verbose: boolean;
  zone: DnsZoneModel;
  domain: string;
  output: string;
}): Promise<void> {
  for (;;) {
    const { next } = await prompts({
      type: "select",
      name: "next",
      message: "What next?",
      choices: [
        {
          title: "Scan for existing records at your current provider",
          value: "scan",
        },
        { title: "Upload a zone file (BIND)", value: "import" },
        { title: "Add records manually", value: "manual" },
        { title: "Continue to nameserver setup", value: "continue" },
      ],
    });
    if (next === undefined || next === "continue") return;
    try {
      if (next === "scan") {
        await scanAndImport({
          client: opts.client,
          zone: opts.zone,
          domain: opts.domain,
          assumeYes: false,
        });
      } else if (next === "import") {
        await importZoneFile({
          client: opts.client,
          zone: opts.zone,
          output: opts.output,
        });
      } else if (next === "manual") {
        await addRecordInteractive({
          client: opts.client,
          config: opts.config,
          verbose: opts.verbose,
          zone: opts.zone,
          output: opts.output,
        });
      }
    } catch (err) {
      // Keep the menu alive when a sub-step is cancelled or fails validation.
      if (err instanceof UserError) logger.warn(err.message);
      else throw err;
    }
    logger.log("");
  }
}

export const dnsZoneAddCommand = defineCommand<ZoneAddArgs>({
  command: "add [domain]",
  describe: "Create a new DNS zone.",
  examples: [
    ["$0 dns zones add example.com", "Create a zone for example.com"],
    ["$0 dns zones add", "Interactive: prompts for the domain"],
    [
      "$0 dns zones add example.com --import",
      "Create the zone and import existing records without prompting",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("domain", {
        type: "string",
        describe: "Domain to manage DNS for",
      })
      .option("import", {
        type: "boolean",
        describe:
          "Scan and import all existing records without prompting (--no-import skips the records menu)",
      }),

  handler: async ({
    domain: domainArg,
    import: doImport,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const interactive = isInteractive(output);

    let domainInput = domainArg;
    if (!domainInput && interactive) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Domain to manage DNS for:",
      });
      domainInput = typeof value === "string" ? value.trim() : value;
    }
    if (!domainInput) {
      throw new UserError(
        "A domain is required.",
        "Pass the domain: bunny dns zones add example.com",
      );
    }
    const domain = domainInput;

    const spin = spinner("Creating DNS zone...");
    spin.start();

    let created: DnsZoneModel | undefined;
    try {
      await client.POST("/dnszone", { body: { Domain: domain } });

      // Look the new zone up to report its ID; a lookup failure must not mask the created zone.
      try {
        const { data } = await client.GET("/dnszone", {
          params: { query: { search: domain, perPage: 1000 } },
        });
        created = (data?.Items ?? []).find(
          (z) => (z.Domain ?? "").toLowerCase() === domain.toLowerCase(),
        );
      } catch {}
    } finally {
      spin.stop();
    }

    if (output === "json") {
      let importedRecords: number | undefined;
      let failedRecords: number | undefined;
      let importError: string | undefined;
      if (doImport === true && created?.Id != null) {
        try {
          const records = await discoverImportableRecords(client, created);
          const { applied, failures } = records.length
            ? await writeRecords(client, created, records)
            : { applied: [], failures: [] };
          importedRecords = applied.length;
          failedRecords = failures.length;
        } catch (err) {
          importError = err instanceof Error ? err.message : String(err);
        }
      }
      logger.log(
        JSON.stringify(
          {
            ...(created ?? { Domain: domain }),
            ...(importedRecords != null
              ? { ImportedRecords: importedRecords }
              : {}),
            ...(failedRecords ? { FailedRecords: failedRecords } : {}),
            ...(importError ? { ImportError: importError } : {}),
          },
          null,
          2,
        ),
      );
      // --import is an explicit migration action; fail loudly when it couldn't run.
      if (importError) {
        throw new UserError(
          `Importing records into ${domain} failed.`,
          importError,
        );
      }

      if (importedRecords === 0 && failedRecords) {
        throw new UserError(
          `Importing records into ${domain} failed: none of the ${failedRecords} record(s) could be added.`,
        );
      }
      return;
    }

    logger.success(
      created?.Id
        ? `Created DNS zone ${domain} (ID: ${created.Id}).`
        : `Created DNS zone ${domain}.`,
    );

    // --import is an explicit migration action: scan and import everything without prompting.
    if (created?.Id != null && doImport === true) {
      await scanAndImport({
        client,
        zone: created,
        domain,
        assumeYes: true,
      });
    }

    // The records menu only runs with a TTY so `zones add <domain>` stays scriptable.
    if (created?.Id != null && doImport === undefined && interactive) {
      await offerNextSteps({
        client,
        config,
        verbose,
        zone: created,
        domain,
        output,
      });
    }

    // Savvy users often point the registrar at bunny before creating the zone; skip the setup steps when it's already delegated.
    const checkSpin = spinner("Checking nameserver delegation...");
    checkSpin.start();
    const nameservers = expectedNameservers(created ?? {});
    let delegated: boolean;
    try {
      const { status } = await checkDelegation(domain, nameservers);
      delegated = status === "bunny";
    } finally {
      checkSpin.stop();
    }

    logger.log("");
    if (delegated) {
      logger.success(
        "Nameservers already point to bunny.net: no changes needed.",
      );
      return;
    }

    const registrar = await detectRegistrar(domain);
    logger.log(
      `Now update your nameservers at ${registrar ?? "your domain registrar"} to:`,
    );
    logger.log("");
    for (const ns of nameservers) logger.log(`  ${ns}`);
    logger.log("");
    logger.dim(
      `Propagation can take up to 48 hours. Verify with:\n  bunny dns zones ns ${domain}`,
    );
  },
});
