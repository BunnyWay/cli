import { bunny } from "@/core/colors.ts";
import { UserError } from "@/core/errors.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";
import type { ToolContext } from "@/tools/index.ts";
import {
  formatUsd,
  type LibraryFeatures,
  OUTPUT_CODECS,
  type OutputCodec,
  PREMIUM_PLANS,
  PREMIUM_PRICE_SUMMARY,
  type PremiumPlan,
  premiumRatePerMinute,
  streamLanguagesList,
  TRANSCRIBING_LANGUAGES,
  TRANSCRIBING_PRICE_PER_MINUTE,
} from "@/tools/stream/index.ts";

const usd = formatUsd;

export const TRANSCRIBING_DOCS_URL =
  "https://bunny.net/docs/stream/transcribing#supported-languages-and-iso-639-1-language-codes";

const PREMIUM_PERKS =
  "encoding queue priority, AV1/H.265/VP9 output, instant playback with just-in-time encoding";

/** "$0.10 per minute of encoded video ($0.05 × 2 codecs)" for a plan and its codecs. */
export function premiumCostText(plan: PremiumPlan, codecCount: number): string {
  const count = Math.max(codecCount, 1);
  const rate = usd(premiumRatePerMinute(plan, count));
  const per = usd(PREMIUM_PLANS[plan].pricePerMinute);
  return `${rate} per minute of encoded video (${per} × ${count} codec${count === 1 ? "" : "s"})`;
}

/**
 * What transcribing to `languages` costs per minute of video. The spoken
 * language is transcribed and billed too, unless it is one of the targets, so
 * the honest figure is a range.
 */
export function transcribingCostText(languages: readonly string[]): string {
  const n = new Set(languages.map((l) => l.toLowerCase())).size;
  const low = usd(TRANSCRIBING_PRICE_PER_MINUTE * n);
  const high = usd(TRANSCRIBING_PRICE_PER_MINUTE * (n + 1));
  return `${low}-${high} per minute of video (${usd(TRANSCRIBING_PRICE_PER_MINUTE)} × ${n} language${n === 1 ? "" : "s"}, plus the detected spoken language unless it is one of them)`;
}

/** A one-line description of what the features turn on, for the success message. */
export function describeFeatures(
  features: LibraryFeatures | undefined,
): string[] {
  if (!features) return [];
  const lines: string[] = [];
  if (features.premium) {
    const plan = PREMIUM_PLANS[features.premium];
    const codecs = (features.codecs ?? ["x264"]).map(
      (c) => OUTPUT_CODECS[c].label,
    );
    lines.push(
      `Premium encoding ${plan.label}, codecs: ${codecs.join(", ")}, Early-Play on (exposes the original files)`,
    );
  }
  const t = features.transcribing;
  if (t) {
    const smart = (
      ["title", "description", "chapters", "moments"] as const
    ).filter((k) => t[k]);
    lines.push(
      `Transcribing to ${t.languages.join(", ")}${smart.length ? `, smart generate: ${smart.join(", ")}` : ""}`,
    );
  }
  return lines;
}

/** What the chosen features will be billed, printed as warnings once the library exists. */
export function featureBillingWarnings(
  features: LibraryFeatures | undefined,
): string[] {
  if (!features) return [];
  const warnings: string[] = [];
  if (features.premium) {
    warnings.push(
      `Premium encoding is billed at ${premiumCostText(features.premium, features.codecs?.length ?? 1)}.`,
    );
  }
  if (features.transcribing) {
    warnings.push(
      `Transcribing is billed at ${transcribingCostText(features.transcribing.languages)}, on every new upload.`,
    );
  }
  return warnings;
}

/** The premium plans and every output codec, as two tables. */
export function formatEncodingOptions(output: OutputFormat = "text"): string {
  const plans = formatTable(
    ["Plan", "Price", "Resolutions"],
    (Object.keys(PREMIUM_PLANS) as PremiumPlan[]).map((key) => {
      const plan = PREMIUM_PLANS[key];
      return [
        plan.label,
        `${usd(plan.pricePerMinute)}/min per codec`,
        `${plan.resolutions[0]} to ${plan.resolutions.at(-1)}`,
      ];
    }),
    output,
  );
  const codecs = formatTable(
    ["Codec", "Code", "Tier"],
    (Object.keys(OUTPUT_CODECS) as OutputCodec[]).map((code) => {
      const codec = OUTPUT_CODECS[code];
      return [codec.label, code, codec.premium ? "Premium" : "Free"];
    }),
    output,
  );
  return `${plans}\n\n${codecs}`;
}

/** Languages as `code  Name` entries in as many columns as the terminal fits. */
export function formatLanguageColumns(
  languages: ReadonlyArray<{ code: string; name: string }>,
  width: number = process.stdout.columns || 80,
  maxName = Number.POSITIVE_INFINITY,
): string {
  const short = (name: string) =>
    name.length > maxName ? `${name.slice(0, maxName - 1)}…` : name;
  const entries = languages.map((l) => `${l.code.padEnd(3)} ${short(l.name)}`);
  const cell = Math.max(...entries.map((e) => e.length), 1) + 3;
  const columns = Math.max(1, Math.floor((width - 2) / cell));
  const rows = Math.ceil(entries.length / columns);
  const lines: string[] = [];
  // Column-major, so the list reads alphabetically down each column.
  for (let row = 0; row < rows; row++) {
    const line: string[] = [];
    for (let col = 0; col < columns; col++) {
      const entry = entries[col * rows + row];
      if (entry) line.push(entry.padEnd(cell));
    }
    lines.push(`  ${line.join("").trimEnd()}`);
  }
  return lines.join("\n");
}

/** The live transcription languages, else the documented list when they can't be fetched. */
async function transcribingLanguages(
  ctx: ToolContext,
): Promise<Array<{ code: string; name: string }>> {
  try {
    const live = await withSpinner("Fetching languages...", () =>
      streamLanguagesList.invoke(ctx, {}),
    );
    const usable = live.filter((l) => l.transcribing);
    if (usable.length > 0)
      return usable.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    // Fall through to the documented list; the API validates the codes anyway.
  }
  logger.dim(
    "Couldn't fetch the live language list; showing the documented one.",
  );
  return [...TRANSCRIBING_LANGUAGES];
}

/**
 * Step 2 of creating a library, after its name and replication regions: the
 * dashboard's "Enable video library features" page.
 *
 * Premium encoding first: the plans and every output codec are listed, then
 * an offer to upgrade (1080p or 4K, one plan only) and, on yes, the codecs to
 * enable (H.264 on by default). Then transcribing: the supported languages
 * and their ISO 639-1 codes are listed, then an offer to enable it and, on
 * yes, the target languages and the smart-generate fields it includes. Both
 * offers default to no, so pressing Enter keeps free encoding with
 * transcribing off. Every choice has a flag on `stream libraries create`.
 *
 * Interactive only: returns undefined without asking when there is no terminal.
 */
export async function promptLibraryFeatures(
  ctx: ToolContext,
  output: OutputFormat | undefined,
): Promise<LibraryFeatures | undefined> {
  if (!isInteractive(output)) return undefined;

  logger.log();
  logger.log(bunny.bold("Enable video library features"));
  logger.dim(
    "Advanced video processing and AI-powered features for higher quality playback, accessibility and automated content enhancement. Change them later with `bunny stream libraries update`.",
  );

  // Premium encoding: list the options, then offer the upgrade.
  logger.log();
  logger.log(bunny.bold("Premium encoding · paid"));
  logger.dim(
    "Saves CDN bandwidth, storage, encoding and playback time with modern codecs, faster encoding and just-in-time delivery.",
  );
  logger.dim(
    `Billed per minute of encoded video at the rate of the highest resolution in the ladder (${PREMIUM_PRICE_SUMMARY}), for every output codec enabled: H.264 + AV1 on the 1080p plan costs ${usd(premiumRatePerMinute("1080p", 2))}/min.`,
  );
  logger.log(formatEncodingOptions());
  logger.log();

  const { premium } = await prompts({
    type: "select",
    name: "premium",
    message: "Upgrade to premium encoding (paid)?",
    choices: [
      {
        title: "No, keep free encoding",
        description: "H.264 (AVC) only, no encoding charge",
        value: "free" as const,
      },
      {
        title: `Yes, 1080p plan · ${usd(PREMIUM_PLANS["1080p"].pricePerMinute)}/min per codec`,
        description: `Resolutions up to 1080p; ${PREMIUM_PERKS}`,
        value: "1080p" as const,
      },
      {
        title: `Yes, 4K plan · ${usd(PREMIUM_PLANS["4k"].pricePerMinute)}/min per codec`,
        description: `Resolutions up to 2160p; ${PREMIUM_PERKS}`,
        value: "4k" as const,
      },
    ],
  });
  if (premium === undefined) throw new UserError("Cancelled.");

  const features: LibraryFeatures = {};
  if (premium !== "free") {
    const plan = premium as PremiumPlan;
    const { codecs } = await prompts({
      type: "multiselect",
      name: "codecs",
      message: `Output codecs to enable (each billed at ${usd(PREMIUM_PLANS[plan].pricePerMinute)}/min and adds storage; space to toggle, enter to confirm):`,
      min: 1,
      instructions: false,
      choices: (Object.keys(OUTPUT_CODECS) as OutputCodec[]).map((code) => ({
        title: `${OUTPUT_CODECS[code].label} (${code})`,
        value: code,
        selected: code === "x264",
      })),
    });
    if (codecs === undefined) throw new UserError("Cancelled.");

    // The total depends on how many codecs were picked, so confirm it.
    const { accept } = await prompts({
      type: "toggle",
      name: "accept",
      message: `Enable premium encoding at ${premiumCostText(plan, codecs.length)}?`,
      initial: true,
      active: "yes",
      inactive: "no, keep free encoding",
    });
    if (accept === undefined) throw new UserError("Cancelled.");
    if (accept) {
      features.premium = plan;
      features.codecs = codecs as OutputCodec[];
    }
  }

  // Transcribing: list the languages, then offer it.
  const languages = await transcribingLanguages(ctx);
  logger.log();
  logger.log(
    bunny.bold(
      `Transcribing · ${usd(TRANSCRIBING_PRICE_PER_MINUTE)}/min per language`,
    ),
  );
  logger.dim(
    `AI-generated captions in ${languages.length} languages (ISO 639-1 codes). The spoken language is detected from the first 30 seconds; each target language is billed and stored as its own caption file.`,
  );
  logger.log(formatLanguageColumns(languages));
  logger.dim(`  ${TRANSCRIBING_DOCS_URL}`);
  logger.log();

  const { transcribe } = await prompts({
    type: "toggle",
    name: "transcribe",
    message: `Enable transcribing (paid, ${usd(TRANSCRIBING_PRICE_PER_MINUTE)}/min per language)?`,
    initial: false,
    active: "yes",
    inactive: "no",
  });
  if (transcribe === undefined) throw new UserError("Cancelled.");

  if (transcribe) {
    const { picked } = await prompts({
      type: "autocompleteMultiselect",
      name: "picked",
      message:
        "Target languages (type a name or code to filter, space to select):",
      min: 1,
      instructions: false,
      choices: languages.map((language) => ({
        title: `${language.code}  ${language.name}`,
        value: language.code,
      })),
    });
    if (picked === undefined) throw new UserError("Cancelled.");
    logger.dim(`Transcribing will cost ${transcribingCostText(picked)}.`);

    const { smart } = await prompts({
      type: "multiselect",
      name: "smart",
      message: "Smart generate, included with transcribing (space to toggle):",
      instructions: false,
      choices: [
        { title: "Video titles", value: "title" },
        { title: "Descriptions", value: "description" },
        { title: "Chapters", value: "chapters" },
        { title: "Moments", value: "moments" },
      ],
    });
    if (smart === undefined) throw new UserError("Cancelled.");
    const chosen = new Set<string>(smart as string[]);
    features.transcribing = {
      languages: picked as string[],
      title: chosen.has("title"),
      description: chosen.has("description"),
      chapters: chosen.has("chapters"),
      moments: chosen.has("moments"),
    };
  }

  return features.premium || features.transcribing ? features : undefined;
}
