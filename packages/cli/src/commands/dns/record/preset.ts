import { createCoreClient } from "@bunny.net/openapi-client";
import { resolveConfig } from "../../../config/index.ts";
import { clientOptions } from "../../../core/client-options.ts";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { formatTable } from "../../../core/format.ts";
import { logger } from "../../../core/logger.ts";
import { prompts } from "../../../core/ui.ts";
import type { CoreClient, DnsZoneModel } from "../api.ts";
import { resolveZoneInteractive } from "../interactive.ts";
import { type DnsPreset, findPreset, PRESETS } from "./presets.ts";
import { reviewAndApply } from "./write.ts";

interface PresetArgs {
  name?: string;
  domain?: string;
  param?: string[];
}

/** Parse repeated `--param key=value` flags into a lookup, trimming blanks. */
function parseParamFlags(flags: string[] | undefined): Record<string, string> {
  const provided: Record<string, string> = {};
  for (const entry of flags ?? []) {
    const eq = entry.indexOf("=");
    if (eq === -1) {
      throw new UserError(
        `Invalid --param "${entry}".`,
        "Use --param key=value (repeat for multiple values).",
      );
    }
    const key = entry.slice(0, eq).trim();
    const value = entry.slice(eq + 1).trim();
    if (key) provided[key] = value;
  }
  return provided;
}

/**
 * Resolve each parameter a preset needs from provided flags, prompting for the
 * rest only when interactive. Non-interactive callers must supply required
 * values via flags; optional blanks are dropped.
 */
async function gatherParams(
  preset: DnsPreset,
  provided: Record<string, string>,
  interactive: boolean,
): Promise<Record<string, string>> {
  const params: Record<string, string> = {};
  for (const param of preset.params) {
    const supplied = provided[param.key]?.trim();
    if (supplied) {
      params[param.key] = supplied;
      continue;
    }
    if (!interactive) {
      if (!param.optional) {
        throw new UserError(
          `Preset "${preset.id}" needs a value for "${param.key}".`,
          `Pass --param ${param.key}=<value> (${param.message}).`,
        );
      }
      continue;
    }
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

/** Expand a preset, confirm in text mode, then write each record. */
export async function applyPreset(opts: {
  client: CoreClient;
  zone: DnsZoneModel;
  preset: DnsPreset;
  output: string;
  provided?: Record<string, string>;
}): Promise<void> {
  const { client, zone, preset, output, provided = {} } = opts;
  // Only plain text drives the interactive prompts; json/csv/... must come fully specified.
  const params = await gatherParams(preset, provided, output === "text");
  const records = preset.build({ domain: zone.Domain ?? "", params });

  if (records.length === 0) {
    throw new UserError("This preset produced no records to add.");
  }

  await reviewAndApply({
    client,
    zone,
    records,
    output,
    selectMessage: `Select records to add to ${zone.Domain}:`,
    spinnerLabel: `Applying ${preset.title}...`,
    successFor: (n) =>
      `Applied ${preset.title} to ${zone.Domain}: ${n} record(s) added.`,
  });
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
  provided?: Record<string, string>;
}): Promise<void> {
  const { client, zone, output, name, provided } = opts;
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
  await applyPreset({ client, zone, preset, output, provided });
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
    [
      "$0 dns records preset bluesky example.com --param did=did:plc:abc123",
      "Apply a preset non-interactively",
    ],
    ["$0 dns records preset list", "List available presets"],
  ],

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "Preset id (omit to pick interactively, or 'list' to list)",
      })
      .positional("domain", { type: "string", describe: "Domain or zone ID" })
      .option("param", {
        type: "string",
        array: true,
        describe:
          "Preset value as key=value (repeatable), e.g. --param did=did:plc:...",
      }),

  handler: async ({
    name,
    domain,
    param,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
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

    const provided = parseParamFlags(param);
    await pickAndApplyPreset({ client, zone, output, name, provided });
  },
});
