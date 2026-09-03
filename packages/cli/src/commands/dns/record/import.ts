import { createCoreClient } from "@bunny.net/openapi-client";
import type { CoreClient, DnsZoneModel } from "@/commands/dns/api.ts";
import { resolveZoneInteractive } from "@/commands/dns/interactive.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { prompts, spinner } from "@/core/ui.ts";

interface ImportArgs {
  domain?: string;
  file?: string;
}

/** Read a BIND zone file (prompting for the path when omitted) and import it into a zone. */
export async function importZoneFile(opts: {
  client: CoreClient;
  zone: DnsZoneModel;
  output: string;
  file?: string;
}): Promise<void> {
  const { client, zone, output } = opts;
  let path = opts.file;
  if (!path) {
    const res = await prompts({
      type: "text",
      name: "file",
      message: "Path to the BIND zone file:",
    });
    path = res.file;
  }
  if (!path) throw new UserError("A zone file path is required.");

  const handle = Bun.file(path);
  if (!(await handle.exists())) {
    throw new UserError(`File not found: ${path}`);
  }
  const contents = await handle.text();

  const spin = spinner("Importing records...");
  spin.start();
  let data: unknown;
  try {
    // The import endpoint takes the raw zone file as its body, which the generated spec doesn't model.
    ({ data } = await client.POST("/dnszone/{zoneId}/import", {
      params: { path: { zoneId: zone.Id as number } },
      body: contents as never,
      bodySerializer: (body: string) => body,
      headers: { "Content-Type": "text/plain" },
    } as never));
  } finally {
    spin.stop();
  }

  const result = data as
    | {
        RecordsSuccessful?: number;
        RecordsFailed?: number;
        RecordsSkipped?: number;
      }
    | undefined;

  if (output === "json") {
    logger.log(JSON.stringify(result ?? {}, null, 2));
    return;
  }

  logger.success(
    `Imported into ${zone.Domain}: ${result?.RecordsSuccessful ?? 0} added, ${result?.RecordsSkipped ?? 0} skipped, ${result?.RecordsFailed ?? 0} failed.`,
  );
}

export const dnsImportCommand = defineCommand<ImportArgs>({
  command: "import [domain] [file]",
  describe: "Import DNS records into a zone from a BIND zone file.",
  examples: [
    [
      "$0 dns records import example.com ./zonefile.txt",
      "Import records from a zone file",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("domain", { type: "string", describe: "Domain or zone ID" })
      .positional("file", {
        type: "string",
        describe: "Path to the BIND zone file",
      }),

  handler: async ({ domain, file, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveZoneInteractive(client, domain, {
      output,
      offerLink: true,
    });

    await importZoneFile({ client, zone, output, file });
  },
});
