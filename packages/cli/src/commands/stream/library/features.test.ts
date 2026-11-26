import { expect, test } from "bun:test";
import prompts from "prompts";
import { withoutTTY, withTTY } from "@/commands/stream/test-tty.ts";
import { type CoreClient, createToolContext } from "@/tools/context.ts";
import {
  formatUsd,
  libraryFeaturesBody,
  PREMIUM_PLANS,
  premiumTierFor,
  TRANSCRIBING_LANGUAGES,
} from "@/tools/stream/index.ts";
import {
  describeFeatures,
  featureBillingWarnings,
  formatEncodingOptions,
  formatLanguageColumns,
  libraryFeaturesFromFlags,
  premiumCostText,
  promptLibraryFeatures,
} from "./features.ts";
import {
  type LibrarySettingsArgs,
  librarySettingsFromFlags,
  librarySettingsWarnings,
} from "./flags.ts";
import { planCodecs } from "./update.ts";

const ctx = createToolContext({
  clients: {
    core: {
      GET: () =>
        Promise.resolve({
          data: [
            { ShortCode: "EN", Name: "English", SupportTranscribing: true },
            { ShortCode: "DE", Name: "German", SupportTranscribing: true },
          ],
        }),
    } as unknown as CoreClient,
  },
});

test("promptLibraryFeatures declining the premium total keeps free encoding", async () => {
  prompts.inject(["1080p", ["x264", "av1", "vp9"], false, false]);
  expect(
    await withTTY(() => promptLibraryFeatures(ctx, "text")),
  ).toBeUndefined();
});

test("promptLibraryFeatures walks premium, codecs, the cost, transcribing, languages and smart generate", async () => {
  prompts.inject([
    "4k",
    ["x264", "av1"],
    true,
    true,
    ["en", "de"],
    ["chapters"],
  ]);
  const features = await withTTY(() => promptLibraryFeatures(ctx, "text"));
  expect(features).toEqual({
    premium: "4k",
    codecs: ["x264", "av1"],
    transcribing: {
      languages: ["en", "de"],
      title: false,
      description: false,
      chapters: true,
      moments: false,
    },
  });
});

test("promptLibraryFeatures returns nothing when both offers are declined, or with no terminal", async () => {
  prompts.inject(["free", false]);
  expect(
    await withTTY(() => promptLibraryFeatures(ctx, "text")),
  ).toBeUndefined();
  expect(
    await withoutTTY(() => promptLibraryFeatures(ctx, "text")),
  ).toBeUndefined();
});

test("promptLibraryFeatures can add transcribing on free encoding", async () => {
  prompts.inject(["free", true, ["de"], []]);
  expect(await withTTY(() => promptLibraryFeatures(ctx, "text"))).toEqual({
    transcribing: {
      languages: ["de"],
      title: false,
      description: false,
      chapters: false,
      moments: false,
    },
  });
});

test("promptLibraryFeatures falls back to the documented languages when the API fails", async () => {
  const failing = createToolContext({
    clients: {
      core: {
        GET: () => Promise.reject(new Error("offline")),
      } as unknown as CoreClient,
    },
  });
  prompts.inject(["free", true, ["cy"], []]);
  const features = await withTTY(() => promptLibraryFeatures(failing, "text"));
  expect(features?.transcribing?.languages).toEqual(["cy"]);
});

test("formatEncodingOptions lists both plans and every codec with its code and tier", () => {
  const text = formatEncodingOptions("csv");
  for (const expected of [
    "1080p,$0.05/min per codec,240p to 1080p",
    "4K,$0.15/min per codec,240p to 2160p",
    "H.264 (AVC),x264,Free",
    "AV1,av1,Premium",
    "H.265 (HEVC),hevc,Premium",
    "VP9,vp9,Premium",
  ])
    expect(text).toContain(expected);
});

test("formatLanguageColumns lists every documented language with its code", () => {
  expect(TRANSCRIBING_LANGUAGES).toHaveLength(56);
  const text = formatLanguageColumns(TRANSCRIBING_LANGUAGES, 100);
  for (const { code, name } of TRANSCRIBING_LANGUAGES)
    expect(text).toContain(`${code.padEnd(3)} ${name}`);
  expect(text.split("\n").every((line) => line.length <= 100)).toBe(true);
});

test("libraryFeaturesBody maps the 1080p and 4K plans to premium plus a resolution ladder", () => {
  expect(
    libraryFeaturesBody({ premium: "1080p", codecs: ["x264", "av1"] }),
  ).toEqual({
    EncodingTier: 1,
    EnabledResolutions: "240p,360p,480p,720p,1080p",
    AllowEarlyPlay: true,
    OutputCodecs: "x264,av1",
  });
});

test("libraryFeaturesBody sends what the dashboard sends for the 4K plan, with AVC on by default", () => {
  expect(libraryFeaturesBody({ premium: "4k" })).toEqual({
    EncodingTier: 1,
    EnabledResolutions: "240p,360p,480p,720p,1080p,1440p,2160p",
    AllowEarlyPlay: true,
    OutputCodecs: "x264",
  });
});

test("libraryFeaturesBody turns on transcribing with smart generate choices", () => {
  expect(
    libraryFeaturesBody({
      transcribing: { languages: ["EN", "de", "en"], chapters: true },
    }),
  ).toEqual({
    EnableTranscribing: true,
    TranscribingCaptionLanguages: ["en", "de"],
    EnableTranscribingTitleGeneration: false,
    EnableTranscribingDescriptionGeneration: false,
    EnableTranscribingChaptersGeneration: true,
    EnableTranscribingMomentsGeneration: false,
  });
});

test("libraryFeaturesBody refuses premium codecs without a premium plan", () => {
  expect(() => libraryFeaturesBody({ codecs: ["x264", "vp9"] })).toThrow(
    "need premium encoding",
  );
  expect(libraryFeaturesBody(undefined)).toEqual({});
});

test("describeFeatures summarizes the choices", () => {
  expect(
    describeFeatures({
      premium: "4k",
      codecs: ["x264", "hevc"],
      transcribing: { languages: ["en"], title: true },
    }),
  ).toEqual([
    "Premium encoding 4K, codecs: H.264 (AVC), H.265 (HEVC), Early-Play on (exposes the original files)",
    "Transcribing to en, smart generate: title",
  ]);
});

test("premium cost multiplies the plan rate by the number of codecs", () => {
  expect(premiumCostText("1080p", 1)).toBe(
    "$0.05 per minute of encoded video ($0.05 × 1 codec)",
  );
  expect(premiumCostText("1080p", 2)).toBe(
    "$0.10 per minute of encoded video ($0.05 × 2 codecs)",
  );
  expect(premiumCostText("4k", 4)).toBe(
    "$0.60 per minute of encoded video ($0.15 × 4 codecs)",
  );
});

test("featureBillingWarnings states what each paid feature costs", () => {
  expect(
    featureBillingWarnings({
      premium: "4k",
      codecs: ["x264", "av1"],
      transcribing: { languages: ["en", "de"] },
    }),
  ).toEqual([
    "Premium encoding is billed at $0.30 per minute of encoded video ($0.15 × 2 codecs).",
    "Transcribing is billed at $0.20-$0.30 per minute of video ($0.10 × 2 languages, plus the detected spoken language unless it is one of them), on every new upload.",
  ]);
  expect(featureBillingWarnings(undefined)).toEqual([]);
});

test("premium is priced by the top resolution of the ladder", () => {
  expect(premiumTierFor(["240p", "360p", "480p"])).toEqual({
    top: "480p",
    pricePerMinute: 0.025,
  });
  expect(premiumTierFor(["720p", "360p"])?.pricePerMinute).toBe(0.05);
  expect(premiumTierFor(["1080p"])?.pricePerMinute).toBe(0.05);
  expect(premiumTierFor(["720p", "1440p"])).toEqual({
    top: "1440p",
    pricePerMinute: 0.15,
  });
  expect(premiumTierFor(["2160p"])?.pricePerMinute).toBe(0.15);
  expect(premiumTierFor([])).toBeUndefined();
  // The plans price by the top of their own ladders.
  for (const plan of Object.values(PREMIUM_PLANS))
    expect(premiumTierFor(plan.resolutions)?.pricePerMinute).toBe(
      plan.pricePerMinute,
    );
});

test("formatUsd keeps tenths of a cent", () => {
  expect(formatUsd(0.025)).toBe("$0.025");
  expect(formatUsd(0.05)).toBe("$0.05");
  expect(formatUsd(0.15)).toBe("$0.15");
  expect(formatUsd(0.075)).toBe("$0.075");
  expect(formatUsd(1.2)).toBe("$1.20");
});

test("premium flags warn with the rate of the top resolution, times the codecs", () => {
  expect(
    librarySettingsWarnings({ encodingPlan: "1080p", codecs: "x264,av1" }),
  ).toContain(
    "Premium encoding is billed at $0.10 per minute of encoded video ($0.05 for a 1080p top resolution × 2 codecs).",
  );
  expect(librarySettingsWarnings({ encodingPlan: "4k" })).toContain(
    "Premium encoding is billed at $0.15 per minute of encoded video for each output codec (2160p top resolution).",
  );
  // --resolutions changes the top resolution, and so the price.
  expect(
    librarySettingsWarnings({
      encodingPlan: "4k",
      resolutions: "240p,360p,480p",
      codecs: "x264,vp9,av1",
    }),
  ).toContain(
    "Premium encoding is billed at $0.075 per minute of encoded video ($0.025 for a 480p top resolution × 3 codecs).",
  );
  expect(
    librarySettingsWarnings({ encodingTier: "premium", resolutions: "1440p" }),
  ).toContain(
    "Premium encoding is billed at $0.15 per minute of encoded video for each output codec (1440p top resolution).",
  );
  // Without a ladder (update keeps the library's), the whole price list is shown.
  expect(librarySettingsWarnings({ encodingTier: "premium" })).toContain(
    "Premium encoding is billed per minute of encoded video, for every output codec, at the rate of the highest enabled resolution: $0.15 (1440p-2160p), $0.05 (720p-1080p), $0.025 (240p-480p).",
  );
});

test("--encoding-plan sets premium and its ladder, and --resolutions still wins", () => {
  expect(librarySettingsFromFlags({ encodingPlan: "1080p" })).toEqual({
    EncodingTier: 1,
    EnabledResolutions: "240p,360p,480p,720p,1080p",
    AllowEarlyPlay: true,
  });
  // Early-Play needs the originals, and an explicit flag wins.
  expect(
    librarySettingsFromFlags({ encodingPlan: "4k", keepOriginal: false })
      .AllowEarlyPlay,
  ).toBeUndefined();
  expect(
    librarySettingsFromFlags({ encodingPlan: "4k", earlyPlay: false })
      .AllowEarlyPlay,
  ).toBe(false);
  expect(
    librarySettingsFromFlags({ encodingPlan: "4k", resolutions: "720p,2160p" })
      .EnabledResolutions,
  ).toBe("720p,2160p");
  expect(() =>
    librarySettingsFromFlags({ encodingPlan: "4k", encodingTier: "free" }),
  ).toThrow("can't be combined with --encoding-tier free");
});

test("update with --encoding-plan sends the codecs explicitly, H.264 unless --codecs says otherwise", () => {
  const implied = planCodecs<LibrarySettingsArgs>({ encodingPlan: "1080p" });
  expect(implied.codecs).toBe("x264");
  expect(librarySettingsFromFlags(implied)).toEqual({
    EncodingTier: 1,
    EnabledResolutions: "240p,360p,480p,720p,1080p",
    AllowEarlyPlay: true,
    OutputCodecs: "x264",
  });
  const explicit = { encodingPlan: "4k", codecs: "x264,av1" };
  expect(planCodecs(explicit)).toBe(explicit);
  const noPlan = { resolutions: "720p" };
  expect(planCodecs(noPlan)).toBe(noPlan);
});

test("libraryFeaturesFromFlags leaves the step to the prompt when no flag answers it", () => {
  expect(libraryFeaturesFromFlags({})).toBeUndefined();
  expect(libraryFeaturesFromFlags({ features: true })).toBeUndefined();
  expect(libraryFeaturesFromFlags({ features: false })).toEqual({
    features: undefined,
    flags: ["--no-features"],
  });
});

test("libraryFeaturesFromFlags builds what the prompt would choose", () => {
  expect(
    libraryFeaturesFromFlags({
      encodingPlan: "4K",
      codecs: "x264,AV1,x264",
      transcribingLanguages: "en, DE",
      transcribingChapters: true,
    }),
  ).toEqual({
    features: {
      premium: "4k",
      codecs: ["x264", "av1"],
      transcribing: {
        languages: ["en", "de"],
        title: false,
        description: false,
        chapters: true,
        moments: false,
      },
    },
    flags: [
      "--encoding-plan",
      "--codecs",
      "--transcribing-languages",
      "--transcribing-chapters",
    ],
  });
  expect(libraryFeaturesFromFlags({ encodingPlan: "1080p" })?.features).toEqual(
    { premium: "1080p" },
  );
});

test("libraryFeaturesFromFlags refuses combinations the step can't produce", () => {
  expect(() => libraryFeaturesFromFlags({ codecs: "av1" })).toThrow(
    "--codecs needs --encoding-plan",
  );
  expect(() =>
    libraryFeaturesFromFlags({ encodingPlan: "1080p", codecs: "mpeg2" }),
  ).toThrow("Invalid --codecs");
  expect(() => libraryFeaturesFromFlags({ transcribingTitle: true })).toThrow(
    "--transcribing-title need --transcribing-languages",
  );
  expect(() =>
    libraryFeaturesFromFlags({ transcribingLanguages: " , " }),
  ).toThrow("at least one language");
  expect(() =>
    libraryFeaturesFromFlags({ features: false, encodingPlan: "4k" }),
  ).toThrow("--no-features can't be combined with --encoding-plan");
});
