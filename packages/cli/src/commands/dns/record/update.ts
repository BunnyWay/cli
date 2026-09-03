import { createCoreClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import {
  resolveRecordInteractive,
  resolveZoneInteractive,
} from "@/commands/dns/interactive.ts";
import {
  CAA_TAGS,
  type DnsRecordModel,
  parseRecordType,
  RECORD_TYPES,
  recordName,
} from "@/commands/dns/record-types.ts";
import { resolveConfig } from "@/config/index.ts";
import { clientOptions } from "@/core/client-options.ts";
import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { isInteractive, prompts, spinner } from "@/core/ui.ts";

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

const FIELD_FLAGS = [
  "name",
  "value",
  "type",
  "ttl",
  "priority",
  "weight",
  "port",
  "flags",
  "tag",
  "comment",
  "disabled",
  "pull-zone",
  "script",
] as const;

const FIELD_PROMPTS = {
  Value: { message: "Value:", kind: "text" },
  Name: { message: "Record name ('@' for apex):", kind: "text" },
  Ttl: { message: "TTL (seconds):", kind: "number" },
  Priority: { message: "Priority:", kind: "number" },
  Weight: { message: "Weight:", kind: "number" },
  Port: { message: "Port:", kind: "number" },
  Flags: { message: "Flags:", kind: "number" },
  Tag: { message: "Tag:", kind: "tag" },
  Comment: { message: "Comment:", kind: "text" },
  PullZoneId: { message: "Pull zone ID:", kind: "number" },
  ScriptId: { message: "Edge Script ID:", kind: "number" },
} as const;
type PromptableField = keyof typeof FIELD_PROMPTS;

async function promptFieldChanges(
  existing: DnsRecordModel,
): Promise<Partial<UpdateDnsRecordModel>> {
  const fields: { title: string; value: PromptableField | "Disabled" }[] = [];
  // PullZone/Script records have no Value; their target is the linked resource ID.
  if (existing.Type === RECORD_TYPES.PULLZONE) {
    fields.push({
      title: `Pull zone (${existing.LinkName || "unknown"})`,
      value: "PullZoneId",
    });
  } else if (existing.Type === RECORD_TYPES.SCRIPT) {
    fields.push({
      title: `Script (${existing.LinkName || "unknown"})`,
      value: "ScriptId",
    });
  } else {
    fields.push({ title: `Value (${existing.Value ?? ""})`, value: "Value" });
  }
  fields.push({ title: `Name (${recordName(existing.Name)})`, value: "Name" });
  fields.push({ title: `TTL (${existing.Ttl ?? "default"})`, value: "Ttl" });
  if (existing.Type === RECORD_TYPES.MX || existing.Type === RECORD_TYPES.SRV)
    fields.push({
      title: `Priority (${existing.Priority ?? 0})`,
      value: "Priority",
    });
  if (existing.Type === RECORD_TYPES.SRV) {
    fields.push({ title: `Weight (${existing.Weight ?? 0})`, value: "Weight" });
    fields.push({ title: `Port (${existing.Port ?? 0})`, value: "Port" });
  }
  if (existing.Type === RECORD_TYPES.CAA) {
    fields.push({ title: `Flags (${existing.Flags ?? 0})`, value: "Flags" });
    fields.push({ title: `Tag (${existing.Tag ?? ""})`, value: "Tag" });
  }
  fields.push({
    title: `Comment (${existing.Comment || "none"})`,
    value: "Comment",
  });
  fields.push({
    title: existing.Disabled ? "Enable the record" : "Disable the record",
    value: "Disabled",
  });

  const { picked } = await prompts({
    type: "multiselect",
    name: "picked",
    message: "Fields to change:",
    choices: fields,
    hint: "Space to toggle, Enter to confirm",
    instructions: false,
  });
  if (!picked || picked.length === 0) {
    throw new UserError("No changes requested.");
  }

  const changes: Partial<UpdateDnsRecordModel> = {};
  for (const field of picked as (PromptableField | "Disabled")[]) {
    if (field === "Disabled") {
      changes.Disabled = !existing.Disabled;
      continue;
    }
    const spec = FIELD_PROMPTS[field];
    // Tag derives its initial from CAA_TAGS below; the linked PullZoneId/ScriptId aren't on the record model.
    const initial =
      field === "Name"
        ? recordName(existing.Name)
        : field === "PullZoneId" || field === "ScriptId" || field === "Tag"
          ? undefined
          : (existing[field] ?? undefined);
    const { value } = await prompts({
      type: spec.kind === "tag" ? "select" : spec.kind,
      name: "value",
      message: spec.message,
      ...(spec.kind === "tag"
        ? {
            choices: CAA_TAGS.map((t) => ({ title: t, value: t })),
            initial: Math.max(0, CAA_TAGS.indexOf(existing.Tag ?? "")),
          }
        : { initial }),
    });
    if (value === undefined) {
      // Report the prompt's label ("Pull zone ID"), not the model field name ("PullZoneId").
      const label = spec.message.split(" (")[0]?.replace(/:$/, "");
      throw new UserError(`${label} is required.`);
    }
    changes[field] = field === "Name" && value === "@" ? "" : value;
  }
  return changes;
}

export const dnsUpdateCommand = defineCommand<UpdateArgs>({
  command: "update [domain] [id]",
  aliases: ["edit"],
  describe: "Update an existing DNS record (prompts when args are omitted).",
  examples: [
    [
      "$0 dns records update example.com 123 --value 198.51.100.2",
      "Change a record value",
    ],
    ["$0 dns records update example.com 123 --ttl 3600", "Change the TTL"],
    ["$0 dns records update example.com 123 --disabled", "Disable a record"],
    [
      "$0 dns records update example.com --value 198.51.100.2",
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

    const zone = await resolveZoneInteractive(client, domain, {
      output,
      offerLink: true,
    });
    const existing = await resolveRecordInteractive(zone, id, "update", output);
    const recordId = existing.Id as number;

    const hasFieldFlags = FIELD_FLAGS.some((f) => args[f] !== undefined);
    if (!hasFieldFlags && !isInteractive(output)) {
      throw new UserError(
        "No changes requested.",
        "Pass at least one field flag, e.g. --value 198.51.100.2 or --ttl 3600.",
      );
    }

    // Seed from the existing record so unspecified fields (including advanced settings) are preserved.
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
      Accelerated: existing.Accelerated ?? null,
      MonitorType: existing.MonitorType ?? null,
      GeolocationLatitude: existing.GeolocationLatitude ?? null,
      GeolocationLongitude: existing.GeolocationLongitude ?? null,
      LatencyZone: existing.LatencyZone ?? null,
      SmartRoutingType: existing.SmartRoutingType ?? null,
      EnviromentalVariables: existing.EnviromentalVariables ?? null,
      AutoSslIssuance: existing.AutoSslIssuance ?? null,
    };

    // AcceleratedPullZoneId is the CDN-acceleration pull zone, not a PullZone-type record's link — only seed it when actually accelerated.
    if (existing.Accelerated && existing.AcceleratedPullZoneId != null) {
      body.PullZoneId = existing.AcceleratedPullZoneId;
    }

    if (!hasFieldFlags) Object.assign(body, await promptFieldChanges(existing));

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
    try {
      await client.POST("/dnszone/{zoneId}/records/{id}", {
        params: { path: { zoneId: zone.Id as number, id: recordId } },
        body,
      });
    } finally {
      spin.stop();
    }

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
