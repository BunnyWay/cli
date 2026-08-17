import { dnsRecordsUpdate } from "@bunny.net/actions";
import prompts from "prompts";
import { defineActionCommand } from "../../../core/define-action-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { isInteractive } from "../../../core/ui.ts";
import {
  resolveRecordInteractive,
  resolveZoneInteractive,
} from "../interactive.ts";
import {
  CAA_TAGS,
  type DnsRecordModel,
  RECORD_TYPES,
  recordName,
} from "../record-types.ts";

type Changes = NonNullable<
  Parameters<typeof dnsRecordsUpdate.run>[1]
>["changes"];

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
  value: { message: "Value:", kind: "text", existing: "Value" },
  name: {
    message: "Record name ('@' for apex):",
    kind: "text",
    existing: "Name",
  },
  ttl: { message: "TTL (seconds):", kind: "number", existing: "Ttl" },
  priority: { message: "Priority:", kind: "number", existing: "Priority" },
  weight: { message: "Weight:", kind: "number", existing: "Weight" },
  port: { message: "Port:", kind: "number", existing: "Port" },
  flags: { message: "Flags:", kind: "number", existing: "Flags" },
  tag: { message: "Tag:", kind: "tag", existing: "Tag" },
  comment: { message: "Comment:", kind: "text", existing: "Comment" },
  pullZoneId: { message: "Pull zone ID:", kind: "number", existing: null },
  scriptId: { message: "Edge Script ID:", kind: "number", existing: null },
} as const;
type PromptableField = keyof typeof FIELD_PROMPTS;

async function promptFieldChanges(existing: DnsRecordModel): Promise<Changes> {
  const fields: { title: string; value: PromptableField | "disabled" }[] = [];
  // PullZone/Script records have no Value; their target is the linked resource ID.
  if (existing.Type === RECORD_TYPES.PULLZONE) {
    fields.push({
      title: `Pull zone (${existing.LinkName || "unknown"})`,
      value: "pullZoneId",
    });
  } else if (existing.Type === RECORD_TYPES.SCRIPT) {
    fields.push({
      title: `Script (${existing.LinkName || "unknown"})`,
      value: "scriptId",
    });
  } else {
    fields.push({ title: `Value (${existing.Value ?? ""})`, value: "value" });
  }
  fields.push({ title: `Name (${recordName(existing.Name)})`, value: "name" });
  fields.push({ title: `TTL (${existing.Ttl ?? "default"})`, value: "ttl" });
  if (existing.Type === RECORD_TYPES.MX || existing.Type === RECORD_TYPES.SRV)
    fields.push({
      title: `Priority (${existing.Priority ?? 0})`,
      value: "priority",
    });
  if (existing.Type === RECORD_TYPES.SRV) {
    fields.push({ title: `Weight (${existing.Weight ?? 0})`, value: "weight" });
    fields.push({ title: `Port (${existing.Port ?? 0})`, value: "port" });
  }
  if (existing.Type === RECORD_TYPES.CAA) {
    fields.push({ title: `Flags (${existing.Flags ?? 0})`, value: "flags" });
    fields.push({ title: `Tag (${existing.Tag ?? ""})`, value: "tag" });
  }
  fields.push({
    title: `Comment (${existing.Comment || "none"})`,
    value: "comment",
  });
  fields.push({
    title: existing.Disabled ? "Enable the record" : "Disable the record",
    value: "disabled",
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

  const changes: Changes = {};
  for (const field of picked as (PromptableField | "disabled")[]) {
    if (field === "disabled") {
      changes.disabled = !existing.Disabled;
      continue;
    }
    const spec = FIELD_PROMPTS[field];
    // Tag derives its initial from CAA_TAGS below; the linked PullZoneId/ScriptId aren't on the record model.
    const initial =
      field === "name"
        ? recordName(existing.Name)
        : spec.existing === null || spec.kind === "tag"
          ? undefined
          : (existing[spec.existing] ?? undefined);
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
      // Report the prompt's label ("Pull zone ID"), not the field name ("pullZoneId").
      const label = spec.message.split(" (")[0]?.replace(/:$/, "");
      throw new UserError(`${label} is required.`);
    }
    changes[field] = value as never;
  }
  return changes;
}

export const dnsUpdateCommand = defineActionCommand({
  action: dnsRecordsUpdate,
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

  progress: "Updating record...",

  prepare: async (args, ctx) => {
    const zone = await resolveZoneInteractive(ctx.clients.core, args.domain, {
      output: args.output,
      offerLink: true,
    });
    const existing = await resolveRecordInteractive(
      zone,
      args.id,
      "update",
      args.output,
    );

    const hasFieldFlags = FIELD_FLAGS.some(
      (f) => (args as UpdateArgs)[f] !== undefined,
    );
    if (!hasFieldFlags && !isInteractive(args.output)) {
      throw new UserError(
        "No changes requested.",
        "Pass at least one field flag, e.g. --value 198.51.100.2 or --ttl 3600.",
      );
    }

    const changes: Changes = hasFieldFlags
      ? {}
      : await promptFieldChanges(existing);

    if (args.name !== undefined) changes.name = args.name;
    if (args.value !== undefined) changes.value = args.value;
    if (args.type !== undefined) changes.type = args.type;
    if (args.ttl !== undefined) changes.ttl = args.ttl;
    if (args.priority !== undefined) changes.priority = args.priority;
    if (args.weight !== undefined) changes.weight = args.weight;
    if (args.port !== undefined) changes.port = args.port;
    if (args.flags !== undefined) changes.flags = args.flags;
    if (args.tag !== undefined) changes.tag = args.tag;
    if (args.comment !== undefined) changes.comment = args.comment;
    if (args.disabled !== undefined) changes.disabled = args.disabled;
    if (args["pull-zone"] !== undefined) changes.pullZoneId = args["pull-zone"];
    if (args.script !== undefined) changes.scriptId = args.script;

    return {
      input: {
        zone: String(zone.Id),
        record: existing.Id as number,
        changes,
      },
    };
  },

  render: (record) => {
    logger.success(
      `Updated record ${record.name} (ID: ${record.id}) in ${record.domain}.`,
    );
  },
});
