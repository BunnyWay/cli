import {
  createComputeClient,
  createCoreClient,
} from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/core.d.ts";
import prompts from "prompts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { isInteractive, spinner } from "../../../core/ui.ts";
import type { CoreClient, DnsZoneModel } from "../api.ts";
import { resolveZoneInteractive } from "../interactive.ts";
import {
  CAA_TAGS,
  type DnsRecordTypes,
  parseRecordType,
  RECORD_TYPE_META,
  RECORD_TYPES,
  recordName,
  recordTypeLabel,
} from "../record-types.ts";
import type { AnswerKind } from "../scripts/constants.ts";
import { pickOrCreateDnsScript } from "../scripts/interactive.ts";
import { pickAndApplyPreset } from "./preset.ts";

type AddDnsRecordModel = components["schemas"]["AddDnsRecordModel"];
type RecordLinks = Pick<AddDnsRecordModel, "PullZoneId" | "ScriptId">;

interface AddArgs {
  domain?: string;
  name?: string;
  type?: string;
  values?: string[];
  ttl?: number;
  comment?: string;
  "pull-zone"?: number;
  script?: number;
}

function rejectExtraValues(
  type: DnsRecordTypes,
  values: string[],
  max: number,
  grammar: string,
): void {
  if (values.length <= max) return;
  throw new UserError(
    `${recordTypeLabel(type)} records take ${grammar}; got ${values.length} values.`,
    max === 1
      ? "Run the command once per value to add multiple records."
      : undefined,
  );
}

/** Build the request body from positional values, honouring per-type grammar. */
function buildRecord(
  type: DnsRecordTypes,
  name: string,
  values: string[],
  links: RecordLinks,
): AddDnsRecordModel {
  const record: AddDnsRecordModel = {
    Type: type,
    Name: name === "@" ? "" : name,
  };

  if (type === RECORD_TYPES.PULLZONE) {
    rejectExtraValues(
      type,
      values,
      0,
      "no positional values (use --pull-zone)",
    );
    if (links.PullZoneId == null)
      throw new UserError("PullZone records require --pull-zone <id>.");
    record.PullZoneId = links.PullZoneId;
    return record;
  }

  if (type === RECORD_TYPES.SCRIPT) {
    rejectExtraValues(type, values, 0, "no positional values (use --script)");
    if (links.ScriptId == null)
      throw new UserError("Script records require --script <id>.");
    record.ScriptId = links.ScriptId;
    return record;
  }

  if (type === RECORD_TYPES.MX) {
    rejectExtraValues(type, values, 2, "<value> <priority>");
    const [value, priority] = values;
    if (!value) throw new UserError("MX records require <value> <priority>.");
    record.Value = value;
    record.Priority = Number(priority ?? 0);
    return record;
  }

  if (type === RECORD_TYPES.SRV) {
    rejectExtraValues(type, values, 4, "<priority> <weight> <port> <target>");
    const [priority, weight, port, target] = values;
    if (!target)
      throw new UserError(
        "SRV records require <priority> <weight> <port> <target>.",
      );
    record.Priority = Number(priority ?? 0);
    record.Weight = Number(weight ?? 0);
    record.Port = Number(port ?? 0);
    record.Value = target;
    return record;
  }

  if (type === RECORD_TYPES.CAA) {
    rejectExtraValues(type, values, 3, "<flags> <tag> <value>");
    let flags: string | undefined;
    let tag: string | undefined;
    let value: string | undefined;
    if (values.length === 1) {
      const match = values[0]?.match(/^(\d+)\s+(\S+)\s+"?([^"]*)"?$/);
      if (!match)
        throw new UserError(
          "CAA value must be like: '0 issue \"example.com\"'.",
        );
      [, flags, tag, value] = match;
    } else {
      [flags, tag, value] = values;
    }
    if (!value)
      throw new UserError("CAA records require <flags> <tag> <value>.");
    record.Flags = Number(flags ?? 0);
    record.Tag = tag;
    record.Value = value;
    return record;
  }

  rejectExtraValues(type, values, 1, "a single value");
  const [value] = values;
  if (!value) throw new UserError("A record value is required.");
  record.Value = value;
  return record;
}

/** Throw if the user aborted a prompt (Esc / Ctrl-C yields undefined). */
function required<T>(value: T | undefined, label: string): T {
  if (value === undefined || value === "") {
    throw new UserError(`${label} is required.`);
  }
  return value;
}

/** Interactively gather a record when positional args were omitted. */
async function promptRecord(
  type: DnsRecordTypes,
  name: string,
): Promise<AddDnsRecordModel> {
  const record: AddDnsRecordModel = {
    Type: type,
    Name: name === "@" ? "" : name,
  };

  if (type === RECORD_TYPES.PULLZONE) {
    const { id } = await prompts({
      type: "number",
      name: "id",
      message: "Pull zone ID:",
    });
    record.PullZoneId = required(id, "Pull zone ID");
    return record;
  }

  if (type === RECORD_TYPES.SCRIPT) {
    const { id } = await prompts({
      type: "number",
      name: "id",
      message: "Script ID:",
    });
    record.ScriptId = required(id, "Script ID");
    return record;
  }

  if (type === RECORD_TYPES.MX) {
    const { value, priority } = await prompts([
      { type: "text", name: "value", message: "Mail server:" },
      { type: "number", name: "priority", message: "Priority:", initial: 10 },
    ]);
    record.Value = required(value, "Mail server");
    record.Priority = priority ?? 10;
    return record;
  }

  if (type === RECORD_TYPES.SRV) {
    const res = await prompts([
      { type: "number", name: "priority", message: "Priority:", initial: 10 },
      { type: "number", name: "weight", message: "Weight:", initial: 0 },
      { type: "number", name: "port", message: "Port:" },
      { type: "text", name: "target", message: "Target:" },
    ]);
    record.Priority = res.priority ?? 10;
    record.Weight = res.weight ?? 0;
    record.Port = required(res.port, "Port");
    record.Value = required(res.target, "Target");
    return record;
  }

  if (type === RECORD_TYPES.CAA) {
    const res = await prompts([
      { type: "number", name: "flags", message: "Flags:", initial: 0 },
      {
        type: "select",
        name: "tag",
        message: "Tag:",
        choices: CAA_TAGS.map((t) => ({ title: t, value: t })),
      },
      { type: "text", name: "value", message: "Value:" },
    ]);
    record.Flags = res.flags ?? 0;
    record.Tag = required(res.tag, "Tag");
    record.Value = required(res.value, "Value");
    return record;
  }

  const { value } = await prompts({
    type: "text",
    name: "value",
    message: "Value:",
  });
  record.Value = required(value, "Value");
  return record;
}

/** Write a single record and report the result (json or a success line). */
async function writeAndReport(
  client: CoreClient,
  zone: DnsZoneModel,
  record: AddDnsRecordModel,
  output: string,
): Promise<void> {
  const spin = spinner("Adding record...");
  spin.start();
  let data: { Id?: number } | undefined;
  try {
    ({ data } = await client.PUT("/dnszone/{zoneId}/records", {
      params: { path: { zoneId: zone.Id as number } },
      body: record,
    }));
  } finally {
    spin.stop();
  }

  if (output === "json") {
    logger.log(JSON.stringify(data, null, 2));
    return;
  }

  logger.success(
    `Added ${recordTypeLabel(record.Type as number)} record ${recordName(record.Name)} to ${zone.Domain}${data?.Id != null ? ` (ID: ${data.Id})` : ""}.`,
  );
}

/**
 * Interactively build and add one record to a zone: pick a type, gather its
 * fields (with the Scriptable DNS option for A/AAAA/CNAME/TXT), then write it.
 * Reused by the records `add` wizard and the `zones add` post-scan menu.
 */
export async function addRecordInteractive(opts: {
  client: CoreClient;
  config: ReturnType<typeof resolveConfig>;
  verbose: boolean;
  zone: DnsZoneModel;
  output: string;
  name?: string;
  ttl?: number;
  comment?: string;
}): Promise<void> {
  const { client, config, verbose, zone, output } = opts;

  const { typeValue } = await prompts({
    type: "select",
    name: "typeValue",
    message: "Record type:",
    choices: RECORD_TYPE_META.map((m) => ({
      title: m.group === "Bunny" ? `${m.name}  ${m.group}` : m.name,
      value: m.value,
    })),
  });
  const type = required(typeValue, "Record type");

  let name = opts.name;
  if (name === undefined) {
    const res = await prompts({
      type: "text",
      name: "name",
      message: "Record name ('@' for apex):",
      initial: "@",
    });
    name = res.name ?? "@";
  }
  const recName = name ?? "@";

  // Offer a script-computed answer for types a DNS script can return.
  const SCRIPTABLE_ANSWERS = new Set<number>([
    RECORD_TYPES.A,
    RECORD_TYPES.AAAA,
    RECORD_TYPES.CNAME,
    RECORD_TYPES.TXT,
  ]);
  let useScript = type === RECORD_TYPES.SCRIPT;
  let starterKind: AnswerKind | undefined;
  if (!useScript && SCRIPTABLE_ANSWERS.has(type)) {
    const { source } = await prompts({
      type: "select",
      name: "source",
      message: "Value source:",
      choices: [
        { title: "Static value", value: "static" },
        { title: "Computed by a script (Scriptable DNS)", value: "script" },
      ],
    });
    if (source === undefined)
      throw new UserError("A value source is required.");
    if (source === "script") {
      useScript = true;
      starterKind = recordTypeLabel(type) as AnswerKind;
    }
  }

  let record: AddDnsRecordModel;
  if (useScript) {
    const computeClient = createComputeClient(clientOptions(config, verbose));
    const picked = await pickOrCreateDnsScript(computeClient, {
      starterKind,
      defaultName: `${zone.Domain ?? "dns"}-script`,
    });
    record = {
      Type: RECORD_TYPES.SCRIPT,
      Name: recName === "@" ? "" : recName,
      ScriptId: picked.id,
    };
  } else {
    record = await promptRecord(type, recName);
  }

  if (opts.ttl === undefined) {
    const { ttl } = await prompts({
      type: "number",
      name: "ttl",
      message: "TTL (seconds, blank for default):",
    });
    if (ttl !== undefined) record.Ttl = ttl;
  } else {
    record.Ttl = opts.ttl;
  }
  if (opts.comment !== undefined) record.Comment = opts.comment;

  await writeAndReport(client, zone, record, output);
}

export const dnsAddCommand = defineCommand<AddArgs>({
  command: "add [domain] [name] [type] [values..]",
  describe: "Add a DNS record to a zone (interactive when args are omitted).",
  examples: [
    ["$0 dns records add example.com api A 198.51.100.1", "Add an A record"],
    [
      "$0 dns records add example.com '@' MX mail.example.com 10",
      "Add an MX record",
    ],
    [
      "$0 dns records add example.com '@' SRV 10 0 389 sip.example.com",
      "Add an SRV record",
    ],
    [
      "$0 dns records add example.com '@' CAA '0 issue \"letsencrypt.org\"'",
      "Add a CAA record",
    ],
    ["$0 dns records add", "Interactive wizard"],
  ],

  builder: (yargs) =>
    yargs
      .positional("domain", { type: "string", describe: "Domain or zone ID" })
      .positional("name", {
        type: "string",
        describe: "Record name (use '@' for the zone apex)",
      })
      .positional("type", {
        type: "string",
        describe: "Record type (A, AAAA, CNAME, TXT, MX, SRV, CAA, NS, ...)",
      })
      .positional("values", {
        type: "string",
        array: true,
        describe: "Record value(s); see examples for per-type ordering",
      })
      .option("ttl", { type: "number", describe: "Time to live in seconds" })
      .option("comment", {
        type: "string",
        describe: "Optional comment for the record",
      })
      .option("pull-zone", {
        type: "number",
        describe: "Pull zone ID (for PullZone records)",
      })
      .option("script", {
        type: "number",
        describe: "Edge Script ID (for Script records)",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    // Interactive when the record type wasn't given positionally.
    const interactive = !args.type;
    if (interactive && !isInteractive(output)) {
      throw new UserError(
        "A record type is required.",
        "Pass positional args: bunny dns records add example.com api A 198.51.100.1",
      );
    }

    // Resolve the target zone (prompt with a picker when no domain given).
    const zone = await resolveZoneInteractive(client, args.domain, {
      output,
      offerLink: true,
    });

    if (interactive) {
      // Offer a ready-made preset before falling back to building a single record by hand.
      const { mode } = await prompts({
        type: "select",
        name: "mode",
        message: "What would you like to add?",
        choices: [
          { title: "A single record", value: "manual" },
          {
            title: "A preset (email providers, verification, security)",
            value: "preset",
          },
        ],
      });
      if (mode === undefined) throw new UserError("A choice is required.");
      if (mode === "preset") {
        await pickAndApplyPreset({ client, zone, output });
        return;
      }

      await addRecordInteractive({
        client,
        config,
        verbose,
        zone,
        output,
        name: args.name,
        ttl: args.ttl,
        comment: args.comment,
      });
      return;
    }

    const type = parseRecordType(args.type as string);
    const name = args.name ?? "@";
    const values = (args.values ?? []).map((v) => String(v));
    let record: AddDnsRecordModel;
    try {
      record = buildRecord(type, name, values, {
        PullZoneId: args["pull-zone"],
        ScriptId: args.script,
      });
    } catch (err) {
      if (
        !(err instanceof UserError) ||
        values.length > 0 ||
        !isInteractive(output)
      ) {
        throw err;
      }
      record = await promptRecord(type, name);
    }
    if (args.ttl !== undefined) record.Ttl = args.ttl;
    if (args.comment !== undefined) record.Comment = args.comment;

    await writeAndReport(client, zone, record, output);
  },
});
