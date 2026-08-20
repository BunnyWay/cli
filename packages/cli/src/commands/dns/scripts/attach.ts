import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, isInteractive, prompts, spinner } from "../../../core/ui.ts";
import { resolveZoneInteractive } from "../interactive.ts";
import {
  type DnsRecordModel,
  formatRecordValue,
  RECORD_TYPES,
  recordName,
  recordTypeLabel,
} from "../record-types.ts";
import { fetchDnsScript } from "./api.ts";
import { resolveDnsScriptId } from "./interactive.ts";

type AddDnsRecordModel = components["schemas"]["AddDnsRecordModel"];

const COMMAND = "attach [domain] [name]";
const DESCRIPTION = "Attach a Scriptable DNS script to a domain.";

const ARG_DOMAIN = "domain";
const ARG_DOMAIN_DESCRIPTION = "Domain or zone ID (prompted when omitted)";
const ARG_NAME = "name";
const ARG_NAME_DESCRIPTION = "Record name (use '@' for the zone apex)";
const ARG_SCRIPT = "script";
const ARG_SCRIPT_DESCRIPTION =
  "DNS script ID (uses the linked script if omitted)";
const ARG_TTL = "ttl";
const ARG_TTL_DESCRIPTION = "Time to live in seconds";
const ARG_FORCE = "force";
const ARG_FORCE_DESCRIPTION = "Skip the confirmation prompt";

interface AttachArgs {
  [ARG_DOMAIN]?: string;
  [ARG_NAME]?: string;
  [ARG_SCRIPT]?: number;
  [ARG_TTL]?: number;
  [ARG_FORCE]?: boolean;
}

/** Describe an existing record for a conflict warning. */
function describeRecord(record: DnsRecordModel): string {
  const value = formatRecordValue(record);
  return value
    ? `${recordTypeLabel(record.Type)} → ${value}`
    : recordTypeLabel(record.Type);
}

/**
 * Attach a Scriptable DNS script to a domain by adding a SCRIPT record that
 * routes the chosen name to the script.
 *
 * This is the bridge between `bunny dns scripts` and the zone's records: a
 * SCRIPT record (`bunny dns records add ... SCRIPT --script <id>`) surfaced
 * from the script's side.
 *
 * @example
 * ```bash
 * # Interactive: pick a zone and the linked script
 * bunny dns scripts attach
 *
 * # Route api.example.com at script 12345
 * bunny dns scripts attach example.com api --script 12345
 * ```
 */
export const dnsScriptsAttachCommand = defineCommand<AttachArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 dns scripts attach", "Pick a zone and the linked script"],
    [
      "$0 dns scripts attach example.com api --script 12345",
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
      .option(ARG_SCRIPT, {
        type: "number",
        describe: ARG_SCRIPT_DESCRIPTION,
      })
      .option(ARG_TTL, {
        type: "number",
        describe: ARG_TTL_DESCRIPTION,
      })
      .option(ARG_FORCE, {
        type: "boolean",
        default: false,
        describe: ARG_FORCE_DESCRIPTION,
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const force = args[ARG_FORCE] ?? false;
    const interactive = isInteractive(output);

    const config = resolveConfig(profile, apiKey, verbose);
    const options = clientOptions(config, verbose);
    const computeClient = createComputeClient(options);
    const coreClient = createCoreClient(options);

    const scriptId = await resolveDnsScriptId(
      computeClient,
      args[ARG_SCRIPT],
      "attach",
      interactive,
    );
    const script = await fetchDnsScript(computeClient, scriptId);

    const zone = await resolveZoneInteractive(coreClient, args[ARG_DOMAIN], {
      output,
      offerLink: true,
    });

    let nameInput = args[ARG_NAME];
    if (nameInput === undefined && interactive) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Record name ('@' for apex):",
        initial: "@",
      });
      nameInput = value ?? "@";
    }
    const name = (nameInput ?? "@").trim();
    const targetName = name === "@" ? "" : name;
    const isApex = targetName === "";
    const hostLabel = isApex ? zone.Domain : `${targetName}.${zone.Domain}`;
    const scriptLabel = script.Name ?? scriptId;

    const record: AddDnsRecordModel = {
      Type: RECORD_TYPES.SCRIPT,
      Name: targetName,
      ScriptId: scriptId,
    };
    if (args[ARG_TTL] !== undefined) record.Ttl = args[ARG_TTL];

    // Records already at this name; surface them so a clobber is never silent.
    const atName = (zone.Records ?? []).filter(
      (r) => (r.Name ?? "") === targetName,
    );

    // Repointing a domain is a silent write; never do it without intent.
    if (!force && !interactive) {
      throw new UserError(
        "Refusing to attach a DNS script without confirmation.",
        "Re-run with --force to attach non-interactively.",
      );
    }

    const warning = isApex
      ? `This repoints the root domain ${zone.Domain} to script ${scriptLabel}.`
      : `Attach script ${scriptLabel} to ${hostLabel}.`;
    const conflict = atName.length
      ? ` ${hostLabel} already has ${atName.map(describeRecord).join(", ")}; the SCRIPT record is added alongside ${atName.length > 1 ? "them" : "it"}.`
      : "";
    const ok = await confirm(`${warning}${conflict} Continue?`, { force });
    if (!ok) {
      logger.info("Cancelled.");
      return;
    }

    const spin = spinner("Attaching...");
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
            name: recordName(targetName),
          },
          null,
          2,
        ),
      );
      return;
    }

    logger.success(
      `Attached DNS script ${scriptLabel} to ${hostLabel}${data?.Id != null ? ` (record ${data.Id})` : ""}.`,
    );
  },
});
