import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { logger } from "@/core/logger.ts";
import {
  resolveStorageZoneInteractive,
  writeStorageManifest,
} from "./interactive.ts";

interface LinkArgs {
  zone?: string;
}

export const storageLinkCommand = defineCommand<LinkArgs>({
  command: "link [zone]",
  describe: "Link the current directory to a storage zone.",
  examples: [
    ["$0 storage link", "Interactive selection"],
    ["$0 storage link my-zone", "Direct link by name or ID"],
  ],

  builder: (yargs) =>
    yargs.positional("zone", {
      type: "string",
      describe: "Storage zone name or ID",
    }),

  handler: async ({ zone: ref, profile, output, verbose, apiKey }) => {
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    // Always re-pick: linking is how the manifest changes, so the existing one must not short-circuit.
    const zone = await resolveStorageZoneInteractive(client, ref, {
      output,
      ignoreManifest: true,
    });
    writeStorageManifest(zone);

    if (output === "json") {
      logger.log(JSON.stringify({ id: zone.Id, name: zone.Name }));
      return;
    }

    logger.success(`Linked to ${zone.Name} (${zone.Id}).`);
  },
});
