import { createCoreClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { logger } from "../../../core/logger.ts";
import { spinner } from "../../../core/ui.ts";
import {
  resolveRecordInteractive,
  resolveZoneInteractive,
} from "../interactive.ts";
import { parseRecordType, recordName } from "../record-types.ts";

type UpdateDnsRecordModel = components["schemas"]["UpdateDnsRecordModel"];

interface UpdateArgs {
  domain?: string;
  id?: number;
  name?: string;
  value?: string;
  type?: string;
  ttl?: number;
  priority?: number;
  weight?: number;
  port?: number;
  flags?: number;
  tag?: string;
  comment?: string;
  disabled?: boolean;
  "pull-zone"?: number;
  script?: number;
}

export const dnsUpdateCommand = defineCommand<UpdateArgs>({
  command: "update [domain] [id]",
  aliases: ["edit"],
  describe: "Update an existing DNS record (prompts when args are omitted).",
  examples: [
    [
      "$0 dns record update example.com 123 --value 198.51.100.2",
      "Change a record value",
    ],
    ["$0 dns record update example.com 123 --ttl 3600", "Change the TTL"],
    ["$0 dns record update example.com 123 --disabled", "Disable a record"],
    [
      "$0 dns record update example.com --value 198.51.100.2",
      "Pick the record interactively",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("domain", { type: "string", describe: "Domain or zone ID" })
      .positional("id", { type: "number", describe: "Record ID" })
      .option("name", {
        type: "string",
        describe: "Record name ('@' for apex)",
      })
      .option("value", { type: "string", describe: "Record value" })
      .option("type", { type: "string", describe: "Record type" })
      .option("ttl", { type: "number", describe: "Time to live in seconds" })
      .option("priority", { type: "number", describe: "Priority (MX/SRV)" })
      .option("weight", { type: "number", describe: "Weight (SRV)" })
      .option("port", { type: "number", describe: "Port (SRV)" })
      .option("flags", { type: "number", describe: "Flags (CAA)" })
      .option("tag", { type: "string", describe: "Tag (CAA)" })
      .option("comment", { type: "string", describe: "Comment for the record" })
      .option("disabled", { type: "boolean", describe: "Disable the record" })
      .option("pull-zone", {
        type: "number",
        describe: "Pull zone ID (for PullZone records)",
      })
      .option("script", {
        type: "number",
        describe: "Edge Script ID (for Script records)",
      }),

  handler: async (args) => {
    const { domain, id, profile, output, verbose, apiKey } = args;

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveZoneInteractive(client, domain);
    const existing = await resolveRecordInteractive(zone, id, "update");
    const recordId = existing.Id as number;

    // Seed from the existing record so unspecified fields are preserved.
    const body: UpdateDnsRecordModel = {
      Type: existing.Type ?? null,
      Ttl: existing.Ttl ?? null,
      Value: existing.Value ?? null,
      Name: existing.Name ?? null,
      Weight: existing.Weight ?? null,
      Priority: existing.Priority ?? null,
      Flags: existing.Flags ?? null,
      Tag: existing.Tag ?? null,
      Port: existing.Port ?? null,
      Disabled: existing.Disabled ?? null,
      Comment: existing.Comment ?? null,
    };

    if (args.name !== undefined) body.Name = args.name === "@" ? "" : args.name;
    if (args.value !== undefined) body.Value = args.value;
    if (args.type !== undefined) body.Type = parseRecordType(args.type);
    if (args.ttl !== undefined) body.Ttl = args.ttl;
    if (args.priority !== undefined) body.Priority = args.priority;
    if (args.weight !== undefined) body.Weight = args.weight;
    if (args.port !== undefined) body.Port = args.port;
    if (args.flags !== undefined) body.Flags = args.flags;
    if (args.tag !== undefined) body.Tag = args.tag;
    if (args.comment !== undefined) body.Comment = args.comment;
    if (args.disabled !== undefined) body.Disabled = args.disabled;
    if (args["pull-zone"] !== undefined) body.PullZoneId = args["pull-zone"];
    if (args.script !== undefined) body.ScriptId = args.script;

    const spin = spinner("Updating record...");
    spin.start();
    await client.POST("/dnszone/{zoneId}/records/{id}", {
      params: { path: { zoneId: zone.Id as number, id: recordId } },
      body,
    });
    spin.stop();

    if (output === "json") {
      logger.log(
        JSON.stringify({ zoneId: zone.Id, id: recordId, ...body }, null, 2),
      );
      return;
    }

    logger.success(
      `Updated record ${recordName(body.Name)} (ID: ${recordId}) in ${zone.Domain}.`,
    );
  },
});
