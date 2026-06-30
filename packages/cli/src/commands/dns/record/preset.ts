import { createCoreClient } from "@bunny.net/openapi-client";
import prompts from "prompts";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { confirm, spinner } from "../../../core/ui.ts";
import type { CoreClient, DnsZoneModel } from "../api.ts";
import { resolveZoneInteractive } from "../interactive.ts";
import { recordName, recordTypeLabel } from "../record-types.ts";
import { type DnsPreset, findPreset, PRESETS } from "./presets.ts";

interface PresetArgs {
  name?: string;
  domain?: string;
}

/** Prompt for each parameter a preset needs; optional blanks are dropped. */
async function gatherParams(
  preset: DnsPreset,
): Promise<Record<string, string>> {
  const params: Record<string, string> = {};
  for (const param of preset.params) {
    const { value } = await prompts({
      type: "text",
      name: "value",
      message: param.optional
        ? `${param.message} (blank to skip)`
        : param.message,
      initial: param.initial,
    });
    const trimmed = (value ?? "").trim();
    if (!trimmed) {
      if (!param.optional) throw new UserError(`${param.message} is required.`);
      continue;
    }
    params[param.key] = trimmed;
  }
  return params;
}

/** Expand a preset, show what it will add, confirm, then write each record. */
export async function applyPreset(opts: {
  client: CoreClient;
  zone: DnsZoneModel;
  preset: DnsPreset;
  output: string;
}): Promise<void> {
  const { client, zone, preset, output } = opts;
  const params = await gatherParams(preset);
  const records = preset.build({ domain: zone.Domain ?? "", params });

  if (records.length === 0) {
    throw new UserError("This preset produced no records to add.");
  }

  if (output === "json") {
    logger.log(JSON.stringify(records, null, 2));
    return;
  }

  logger.log(`This will add ${records.length} record(s) to ${zone.Domain}:`);
  logger.log("");
  logger.log(
    formatTable(
      ["Type", "Name", "Value", "Priority"],
      records.map((r) => [
        recordTypeLabel(r.Type),
        recordName(r.Name),
        r.Value ?? "",
        r.Priority != null ? String(r.Priority) : "",
      ]),
      "text",
    ),
  );
  logger.log("");

  if (
    !(await confirm(`Add these ${records.length} record(s)?`, {
      initial: true,
    }))
  ) {
    logger.info("Cancelled.");
    return;
  }

  const spin = spinner(`Applying ${preset.title}...`);
  spin.start();
  try {
    for (const record of records) {
      await client.PUT("/dnszone/{zoneId}/records", {
        params: { path: { zoneId: zone.Id as number } },
        body: record,
      });
    }
  } finally {
    spin.stop();
  }

  logger.success(
    `Applied ${preset.title} to ${zone.Domain}: ${records.length} record(s) added.`,
  );
}

/** Interactive picker grouped by category; returns undefined if the user aborts. */
export async function pickPreset(): Promise<DnsPreset | undefined> {
  const { id } = await prompts({
    type: "select",
    name: "id",
    message: "Choose a preset:",
    choices: PRESETS.map((t) => ({
      title: `${t.title}  ${t.category}`,
      description: t.description,
      value: t.id,
    })),
  });
  return id ? findPreset(id) : undefined;
}

/** Pick a preset (when none named) and apply it to an already-resolved zone. */
export async function pickAndApplyPreset(opts: {
  client: CoreClient;
  zone: DnsZoneModel;
  output: string;
  name?: string;
}): Promise<void> {
  const { client, zone, output, name } = opts;
  const preset = name ? findPreset(name) : await pickPreset();
  if (!preset) {
    if (name) {
      throw new UserError(
        `Unknown preset "${name}".`,
        `Run "bunny dns records preset" to choose from the list.`,
      );
    }
    return;
  }
  await applyPreset({ client, zone, preset, output });
}

export const dnsPresetCommand = defineCommand<PresetArgs>({
  command: "preset [name] [domain]",
  describe:
    "Add a preset set of DNS records (email providers, verification, ...).",
  examples: [
    ["$0 dns records preset", "Pick a preset interactively"],
    [
      "$0 dns records preset google-workspace example.com",
      "Apply a named preset",
    ],
    ["$0 dns records preset list", "List available presets"],
  ],

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "Preset id (omit to pick interactively, or 'list' to list)",
      })
      .positional("domain", { type: "string", describe: "Domain or zone ID" }),

  handler: async ({ name, domain, profile, output, verbose, apiKey }) => {
    if (name === "list") {
      if (output === "json") {
        logger.log(
          JSON.stringify(
            PRESETS.map(({ id, title, category, description }) => ({
              id,
              title,
              category,
              description,
            })),
            null,
            2,
          ),
        );
        return;
      }
      logger.log(
        formatTable(
          ["Preset", "Category", "Description"],
          PRESETS.map((t) => [t.id, t.category, t.description]),
          output,
        ),
      );
      return;
    }

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createCoreClient(clientOptions(config, verbose));

    const zone = await resolveZoneInteractive(client, domain, {
      output,
      offerLink: true,
    });

    await pickAndApplyPreset({ client, zone, output, name });
  },
});
