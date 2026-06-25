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
import { spinner } from "../../../core/ui.ts";
import { resolveZoneInteractive } from "../interactive.ts";
import {
  type DnsRecordTypes,
  parseRecordType,
  RECORD_TYPES,
  recordName,
  recordTypeLabel,
} from "../record-types.ts";
import { fetchDnsScripts } from "../scripts/api.ts";

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
    if (links.PullZoneId == null)
      throw new UserError("PullZone records require --pull-zone <id>.");
    record.PullZoneId = links.PullZoneId;
    return record;
  }

  if (type === RECORD_TYPES.SCRIPT) {
    if (links.ScriptId == null)
      throw new UserError("Script records require --script <id>.");
    record.ScriptId = links.ScriptId;
    return record;
  }

  if (type === RECORD_TYPES.MX) {
    const [value, priority] = values;
    if (!value) throw new UserError("MX records require <value> <priority>.");
    record.Value = value;
    record.Priority = Number(priority ?? 0);
    return record;
  }

  if (type === RECORD_TYPES.SRV) {
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
  dnsScripts: Array<{ id: number; name: string }> = [],
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
    // Offer the account's DNS scripts as a picker; fall back to a manual ID.
    if (dnsScripts.length > 0) {
      const { id } = await prompts({
        type: "select",
        name: "id",
        message: "DNS script:",
        choices: [
          ...dnsScripts.map((s) => ({
            title: `${s.name} (${s.id})`,
            value: s.id,
          })),
          { title: "Enter a script ID manually", value: -1 },
        ],
      });
      if (id !== undefined && id !== -1) {
        record.ScriptId = id;
        return record;
      }
    }
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
        choices: [
          { title: "issue", value: "issue" },
          { title: "issuewild", value: "issuewild" },
          { title: "iodef", value: "iodef" },
        ],
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
        describe: "Record value(s) — see examples for per-type ordering",
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

    // Resolve the target zone (prompt with a picker when no domain given).
    const zone = await resolveZoneInteractive(client, args.domain, {
      output,
      offerLink: true,
    });

    let record: AddDnsRecordModel;
    if (interactive) {
      const { typeValue } = await prompts({
        type: "select",
        name: "typeValue",
        message: "Record type:",
        choices: Object.values(RECORD_TYPES).map((value) => ({
          title: recordTypeLabel(value),
          value,
        })),
      });
      const type = required(typeValue, "Record type");

      let name = args.name;
      if (name === undefined) {
        const res = await prompts({
          type: "text",
          name: "name",
          message: "Record name ('@' for apex):",
          initial: "@",
        });
        name = res.name ?? "@";
      }

      // For SCRIPT records, offer the account's DNS scripts as a picker.
      let dnsScripts: Array<{ id: number; name: string }> = [];
      if (type === RECORD_TYPES.SCRIPT) {
        const scriptSpin = spinner("Fetching DNS scripts...");
        scriptSpin.start();
        try {
          const computeClient = createComputeClient(
            clientOptions(config, verbose),
          );
          dnsScripts = (await fetchDnsScripts(computeClient))
            .filter((s): s is typeof s & { Id: number } => s.Id != null)
            .map((s) => ({ id: s.Id, name: s.Name ?? "(unnamed)" }));
        } finally {
          scriptSpin.stop();
        }
      }

      record = await promptRecord(type, name ?? "@", dnsScripts);

      if (args.ttl === undefined) {
        const { ttl } = await prompts({
          type: "number",
          name: "ttl",
          message: "TTL (seconds, blank for default):",
        });
        if (ttl !== undefined) record.Ttl = ttl;
      }
    } else {
      const type = parseRecordType(args.type as string);
      const name = args.name ?? "@";
      const values = (args.values ?? []).map((v) => String(v));
      record = buildRecord(type, name, values, {
        PullZoneId: args["pull-zone"],
        ScriptId: args.script,
      });
    }

    if (args.ttl !== undefined) record.Ttl = args.ttl;
    if (args.comment !== undefined) record.Comment = args.comment;

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
  },
});
