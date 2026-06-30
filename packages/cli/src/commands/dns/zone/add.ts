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
import { spinner } from "../../../core/ui.ts";
import type { CoreClient, DnsZoneModel } from "../api.ts";
import { addRecordInteractive } from "../record/add.ts";
import { importZoneFile } from "../record/import.ts";
import { discoverImportableRecords } from "../record/scan-records.ts";
import { reviewAndApply, writeRecords } from "../record/write.ts";

interface ZoneAddArgs {
  domain: string;
  import?: boolean;
}

/** After the scan, let the user keep populating the zone until they continue to nameserver setup. */
async function offerNextSteps(opts: {
  client: CoreClient;
  config: ReturnType<typeof resolveConfig>;
  verbose: boolean;
  zone: DnsZoneModel;
  output: string;
}): Promise<void> {
  for (;;) {
    const { next } = await prompts({
      type: "select",
      name: "next",
      message: "What next?",
      choices: [
        { title: "Upload a zone file (BIND)", value: "import" },
        { title: "Add records manually", value: "manual" },
        { title: "Continue to nameserver setup", value: "continue" },
      ],
    });
    if (next === undefined || next === "continue") return;
    try {
      if (next === "import") {
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
  command: "add <domain>",
  describe: "Create a new DNS zone.",
  examples: [
    ["$0 dns zones add example.com", "Create a zone for example.com"],
    [
      "$0 dns zones add example.com --import",
      "Create the zone and import existing records without prompting",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("domain", {
        type: "string",
        describe: "Domain to create the zone for",
        demandOption: true,
      })
      .option("import", {
        type: "boolean",
        describe:
          "Import all scanned records without prompting (--no-import skips the scan and next-steps menu)",
      }),

  handler: async ({
    domain,
    import: doImport,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

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

    // Default scan+menu only run with a TTY so `zones add <domain>` stays scriptable; --import forces it.
    const interactive = Boolean(process.stdin.isTTY);

    if (
      created?.Id != null &&
      (doImport === true || (doImport === undefined && interactive))
    ) {
      let discovered: Awaited<ReturnType<typeof discoverImportableRecords>> =
        [];
      let scanError: unknown;
      const scanSpin = spinner("Scanning for existing DNS records...");
      scanSpin.start();
      try {
        discovered = await discoverImportableRecords(client, created);
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
          client,
          zone: created,
          records: discovered,
          output,
          selectMessage: `Found ${discovered.length} existing record(s) for ${domain} at your current provider. Select which to import:`,
          spinnerLabel: "Importing records...",
          successFor: (n) => `Imported ${n} record(s) into ${domain}.`,
          assumeYes: doImport === true,
        });
      } else {
        logger.info(`No existing records found for ${domain}.`);
      }
    }

    if (created?.Id != null && doImport === undefined && interactive) {
      await offerNextSteps({ client, config, verbose, zone: created, output });
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
