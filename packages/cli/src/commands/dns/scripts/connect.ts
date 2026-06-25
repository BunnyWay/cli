import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, spinner } from "../../../core/ui.ts";
import { resolveZoneInteractive } from "../interactive.ts";
import { RECORD_TYPES, recordName } from "../record-types.ts";
import { fetchDnsScript } from "./api.ts";
import { resolveDnsScriptId } from "./interactive.ts";

type AddDnsRecordModel = components["schemas"]["AddDnsRecordModel"];

const COMMAND = "connect [domain] [name] [id]";
const DESCRIPTION = "Point a DNS record at a Scriptable DNS script.";

const ARG_DOMAIN = "domain";
const ARG_DOMAIN_DESCRIPTION = "Domain or zone ID (prompted when omitted)";
const ARG_NAME = "name";
const ARG_NAME_DESCRIPTION = "Record name (use '@' for the zone apex)";
const ARG_ID = "id";
const ARG_ID_DESCRIPTION = "DNS script ID (uses the linked script if omitted)";
const ARG_TTL = "ttl";
const ARG_TTL_DESCRIPTION = "Time to live in seconds";

interface ConnectArgs {
  [ARG_DOMAIN]?: string;
  [ARG_NAME]?: string;
  [ARG_ID]?: number;
  [ARG_TTL]?: number;
}

/**
 * Connect a Scriptable DNS script to a zone by adding a SCRIPT record that
 * routes the chosen name to the script.
 *
 * This is the bridge between `bunny dns scripts` and the zone's records: a
 * SCRIPT record (`bunny dns records add ... SCRIPT --script <id>`) surfaced
 * from the script's side.
 *
 * @example
 * ```bash
 * # Interactive: pick a zone and the linked script
 * bunny dns scripts connect
 *
 * # Route api.example.com at script 12345
 * bunny dns scripts connect example.com api 12345
 * ```
 */
export const dnsScriptsConnectCommand = defineCommand<ConnectArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 dns scripts connect", "Pick a zone and the linked script"],
    [
      "$0 dns scripts connect example.com api 12345",
      "Route api.example.com at script 12345",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional(ARG_DOMAIN, {
        type: "string",
        describe: ARG_DOMAIN_DESCRIPTION,
      })
      .positional(ARG_NAME, {
        type: "string",
        describe: ARG_NAME_DESCRIPTION,
      })
      .positional(ARG_ID, {
        type: "number",
        describe: ARG_ID_DESCRIPTION,
      })
      .option(ARG_TTL, {
        type: "number",
        describe: ARG_TTL_DESCRIPTION,
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const isInteractive = output !== "json" && process.stdout.isTTY;

    const config = resolveConfig(profile, apiKey, verbose);
    const options = clientOptions(config, verbose);
    const computeClient = createComputeClient(options);
    const coreClient = createCoreClient(options);

    const scriptId = await resolveDnsScriptId(
      computeClient,
      args[ARG_ID],
      "connect",
      isInteractive,
    );
    const script = await fetchDnsScript(computeClient, scriptId);

    const zone = await resolveZoneInteractive(coreClient, args[ARG_DOMAIN], {
      output,
      offerLink: true,
    });

    const name = (args[ARG_NAME] ?? "@").trim();
    const record: AddDnsRecordModel = {
      Type: RECORD_TYPES.SCRIPT,
      Name: name === "@" ? "" : name,
      ScriptId: scriptId,
    };
    if (args[ARG_TTL] !== undefined) record.Ttl = args[ARG_TTL];

    if (isInteractive) {
      const ok = await confirm(
        `Add SCRIPT record ${recordName(record.Name)}.${zone.Domain} -> ${script.Name ?? scriptId}?`,
      );
      if (!ok) {
        logger.info("Cancelled.");
        return;
      }
    }

    const spin = spinner("Connecting...");
    spin.start();
    let data: { Id?: number } | undefined;
    try {
      ({ data } = await coreClient.PUT("/dnszone/{zoneId}/records", {
        params: { path: { zoneId: zone.Id as number } },
        body: record,
      }));
    } finally {
      spin.stop();
    }

    if (output === "json") {
      logger.log(
        JSON.stringify(
          {
            zoneId: zone.Id,
            recordId: data?.Id ?? null,
            scriptId,
            name: recordName(record.Name),
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(
      `Connected ${recordName(record.Name)}.${zone.Domain} to DNS script ${script.Name ?? scriptId}${data?.Id != null ? ` (record ${data.Id})` : ""}.`,
    );
  },
});
