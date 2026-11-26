import { UserError } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/core";
import { z } from "zod";

export type VideoLibraryModel = components["schemas"]["VideoLibraryModel"];
export type VideoLibraryUpdateModel =
  components["schemas"]["VideoLibraryUpdateModel"];
export type VideoLibraryLanguageModel =
  components["schemas"]["VideoLibraryLanguage"];

/** The main storage region of every Stream library. Fixed: it can't be changed or removed. */
export const MAIN_REGION = "DE";

/** Every region code a library can replicate to, including the main region. */
export const REGION_CODES = [
  "DE",
  "UK",
  "SE",
  "NY",
  "LA",
  "SG",
  "SYD",
  "BR",
  "JH",
] as const;

/** Replication regions preselected when `stream libraries create` asks which to add. */
export const SUGGESTED_REPLICATION_REGIONS: readonly string[] = [
  "SG",
  "LA",
  "NY",
];

/** Upper-case, validate, and dedupe region codes, dropping `DE`, which is never a replication zone. */
export function parseReplicationRegions(values: readonly string[]): string[] {
  const codes = values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const invalid = codes.filter(
    (code) => !(REGION_CODES as readonly string[]).includes(code),
  );
  if (invalid.length > 0) {
    throw new UserError(
      `Invalid replication region(s): ${[...new Set(invalid)].join(", ")}.`,
      `Valid codes: ${REGION_CODES.join(", ")}.`,
    );
  }
  return [...new Set(codes)].filter((code) => code !== MAIN_REGION);
}

/** Every region a library is stored in: the main region first, then its replicas. */
export function allRegions(
  replicas: readonly string[] | null | undefined,
): string[] {
  return [MAIN_REGION, ...(replicas ?? []).filter((r) => r !== MAIN_REGION)];
}

export const LibrarySummarySchema = z.object({
  id: z.number(),
  name: z.string(),
  videoCount: z.number(),
  pullZoneId: z.number().nullable(),
  storageZoneId: z.number().nullable(),
  regions: z.array(z.string()),
});
export type LibrarySummary = z.infer<typeof LibrarySummarySchema>;

export function toLibrarySummary(library: VideoLibraryModel): LibrarySummary {
  return {
    id: library.Id ?? 0,
    name: library.Name ?? "",
    videoCount: library.VideoCount ?? 0,
    pullZoneId: library.PullZoneId || null,
    storageZoneId: library.StorageZoneId || null,
    regions: allRegions(library.ReplicationRegions),
  };
}

export const LanguageSchema = z.object({
  code: z.string(),
  name: z.string(),
  /** Available as the player UI language (`UILanguage`). */
  player: z.boolean(),
  /** Available as a transcription output language. */
  transcribing: z.boolean(),
});
export type Language = z.infer<typeof LanguageSchema>;

export function toLanguage(language: VideoLibraryLanguageModel): Language {
  return {
    code: (language.ShortCode ?? "").toLowerCase(),
    name: language.Name ?? "",
    player: language.SupportPlayerTranslation ?? false,
    transcribing: language.SupportTranscribing ?? false,
  };
}

export function assertLanguages(
  codes: readonly string[],
  languages: readonly Language[],
  use: "player" | "transcribing",
): void {
  const supported = new Set(
    languages.filter((language) => language[use]).map((l) => l.code),
  );
  const invalid = codes
    .map((code) => code.trim().toLowerCase())
    .filter((code) => code && !supported.has(code));
  if (invalid.length > 0) {
    const what =
      use === "player" ? "player UI language" : "transcription language";
    throw new UserError(
      `Unsupported ${what}(s): ${[...new Set(invalid)].join(", ")}.`,
      `Supported: ${[...supported].sort().join(", ")}.`,
    );
  }
}

/** Player control names, as `Controls` takes them. */
export const PLAYER_CONTROLS = [
  "play-large",
  "play",
  "progress",
  "current-time",
  "duration",
  "rewind",
  "fast-forward",
  "mute",
  "volume",
  "captions",
  "settings",
  "pip",
  "airplay",
  "chromecast",
  "fullscreen",
] as const;
export type PlayerControl = (typeof PLAYER_CONTROLS)[number];

/** Playback speed presets the API documents; custom positive values are accepted too. */
export const PLAYBACK_SPEED_PRESETS = [
  "0.25",
  "0.5",
  "0.75",
  "1.0",
  "1.25",
  "1.5",
  "1.75",
  "2.0",
  "2.5",
  "3",
  "3.5",
  "4",
] as const;

/** `Controls` value the API takes for "every control off" (the dashboard's Player Controls toggle). */
export const CONTROLS_OFF = "0";

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour like #FF7755.");

const speed = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "Use a number like 1.25.")
  .refine((value) => Number(value) > 0, "Speeds must be greater than 0.");

export const PlayerSettingsSchema = z.object({
  library: z.number(),
  language: z.string().nullable(),
  font: z.string().nullable(),
  color: z.string().nullable(),
  captionColor: z.string().nullable(),
  captionBackground: z.string().nullable(),
  captionSize: z.number().nullable(),
  /** False when every control is off (`Controls: "0"`). */
  controlsEnabled: z.boolean(),
  controls: z.array(z.string()),
  speeds: z.array(z.string()),
  customHtml: z.string().nullable(),
  heatmap: z.boolean(),
  rememberPosition: z.boolean(),
  compactControls: z.boolean(),
  /** 1 = legacy player, 2 = current player. */
  playerVersion: z.number().nullable(),
  legacyPlayer: z.boolean(),
  captionsInPlaylist: z.boolean(),
});
export type PlayerSettings = z.infer<typeof PlayerSettingsSchema>;

/** Player changes. Every field is optional; only the ones given are sent. */
export const PlayerChangesSchema = z.strictObject({
  language: z.string().min(2).optional(),
  font: z.string().min(1).optional(),
  color: hexColor.optional(),
  captionColor: hexColor.optional(),
  captionBackground: hexColor.optional(),
  captionSize: z.number().int().positive().optional(),
  /** A list of controls, or `false` to turn every control off. */
  controls: z
    .union([z.array(z.enum(PLAYER_CONTROLS)).min(1), z.literal(false)])
    .optional(),
  speeds: z.array(speed).min(1).optional(),
  customHtml: z.string().optional(),
  heatmap: z.boolean().optional(),
  rememberPosition: z.boolean().optional(),
  compactControls: z.boolean().optional(),
  playerVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  captionsInPlaylist: z.boolean().optional(),
});
export type PlayerChanges = z.infer<typeof PlayerChangesSchema>;

/** What `player reset` restores: the dashboard's Player page defaults. */
export const PLAYER_DEFAULTS = {
  language: "en",
  font: "Rubik",
  color: "#FF7755",
  captionColor: "#FFFFFF",
  captionBackground: "#000000",
  captionSize: 20,
  controls: [
    "play-large",
    "play",
    "progress",
    "current-time",
    "mute",
    "volume",
    "captions",
    "settings",
    "pip",
    "fullscreen",
  ],
  speeds: ["0.5", "0.75", "1.0", "1.25", "1.5", "1.75", "2.0", "4"],
} satisfies PlayerChanges;

function csv(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function toPlayerSettings(library: VideoLibraryModel): PlayerSettings {
  const controlsOff = (library.Controls ?? "").trim() === CONTROLS_OFF;
  return {
    library: library.Id ?? 0,
    language: library.UILanguage ?? null,
    font: library.FontFamily ?? null,
    color: library.PlayerKeyColor ?? null,
    captionColor: library.CaptionsFontColor ?? null,
    captionBackground: library.CaptionsBackground ?? null,
    captionSize: library.CaptionsFontSize ?? null,
    controlsEnabled: !controlsOff,
    controls: controlsOff ? [] : csv(library.Controls),
    speeds: csv(library.PlaybackSpeeds),
    customHtml: library.CustomHTML || null,
    heatmap: library.ShowHeatmap ?? false,
    rememberPosition: library.RememberPlayerPosition ?? false,
    compactControls: library.EnableCompactControls ?? false,
    playerVersion: library.PlayerVersion ?? null,
    legacyPlayer: library.PlayerVersion === 1,
    captionsInPlaylist: library.EnableCaptionsInPlaylist ?? false,
  };
}

export function playerUpdateBody(
  changes: PlayerChanges,
): VideoLibraryUpdateModel {
  const body: VideoLibraryUpdateModel = {};
  if (changes.language !== undefined)
    body.UILanguage = changes.language.toLowerCase();
  if (changes.font !== undefined) body.FontFamily = changes.font;
  if (changes.color !== undefined) body.PlayerKeyColor = changes.color;
  if (changes.captionColor !== undefined)
    body.CaptionsFontColor = changes.captionColor;
  if (changes.captionBackground !== undefined)
    body.CaptionsBackground = changes.captionBackground;
  if (changes.captionSize !== undefined)
    body.CaptionsFontSize = changes.captionSize;
  if (changes.controls !== undefined)
    body.Controls =
      changes.controls === false
        ? CONTROLS_OFF
        : [...new Set(changes.controls)].join(",");
  if (changes.speeds !== undefined)
    body.PlaybackSpeeds = [...new Set(changes.speeds)].join(",");
  if (changes.customHtml !== undefined) body.CustomHTML = changes.customHtml;
  if (changes.heatmap !== undefined) body.ShowHeatmap = changes.heatmap;
  if (changes.rememberPosition !== undefined)
    body.RememberPlayerPosition = changes.rememberPosition;
  if (changes.compactControls !== undefined)
    body.EnableCompactControls = changes.compactControls;
  if (changes.playerVersion !== undefined)
    body.PlayerVersion = changes.playerVersion;
  if (changes.captionsInPlaylist !== undefined)
    body.EnableCaptionsInPlaylist = changes.captionsInPlaylist;
  return body;
}

const DRM_VERSIONS = { 0: "basic", 1: "enterprise", 2: "basicV2" } as const;
/** `DrmVersion` value for MediaCage Basic DRM. */
export const DRM_BASIC = 0;
/** `DrmVersion` value for MediaCage Enterprise DRM, which is never switched on or off here. */
export const DRM_ENTERPRISE = 1;

export const SecuritySettingsSchema = z.object({
  library: z.number(),
  pullZoneId: z.number().nullable(),
  directPlay: z.boolean(),
  allowedDomains: z.array(z.string()),
  blockedDomains: z.array(z.string()),
  blockDirectAccess: z.boolean(),
  embedToken: z.boolean(),
  /** Read from the linked Pull Zone (`ZoneSecurityEnabled`); null without one. */
  cdnToken: z.boolean().nullable(),
  /** Read from the linked Pull Zone (`ZoneSecurityIncludeHashRemoteIP`); null without one. */
  tokenIp: z.boolean().nullable(),
  drm: z.object({
    enabled: z.boolean(),
    version: z.enum(["basic", "enterprise", "basicV2"]).nullable(),
  }),
});
export type SecuritySettings = z.infer<typeof SecuritySettingsSchema>;

export interface PullZoneSecurity {
  ZoneSecurityEnabled?: boolean;
  ZoneSecurityIncludeHashRemoteIP?: boolean;
}

export function toSecuritySettings(
  library: VideoLibraryModel,
  pullZone: PullZoneSecurity | null,
): SecuritySettings {
  const version = library.DrmVersion;
  return {
    library: library.Id ?? 0,
    pullZoneId: library.PullZoneId || null,
    directPlay: library.AllowDirectPlay ?? false,
    allowedDomains: library.AllowedReferrers ?? [],
    blockedDomains: library.BlockedReferrers ?? [],
    blockDirectAccess: library.BlockNoneReferrer ?? false,
    embedToken: library.PlayerTokenAuthenticationEnabled ?? false,
    cdnToken: pullZone ? (pullZone.ZoneSecurityEnabled ?? false) : null,
    tokenIp: pullZone
      ? (pullZone.ZoneSecurityIncludeHashRemoteIP ?? false)
      : null,
    drm: {
      enabled: library.EnableDRM ?? false,
      version:
        version === undefined || version === null
          ? null
          : (DRM_VERSIONS[version as keyof typeof DRM_VERSIONS] ?? null),
    },
  };
}

export const SecurityChangesSchema = z.strictObject({
  directPlay: z.boolean().optional(),
  blockDirectAccess: z.boolean().optional(),
  embedToken: z.boolean().optional(),
  cdnToken: z.boolean().optional(),
  tokenIp: z.boolean().optional(),
  /** MediaCage Basic DRM on or off. Never touches Enterprise DRM. */
  drmBasic: z.boolean().optional(),
});
export type SecurityChanges = z.infer<typeof SecurityChangesSchema>;

export function securityUpdateBody(
  changes: SecurityChanges,
): VideoLibraryUpdateModel {
  const body: VideoLibraryUpdateModel = {};
  if (changes.directPlay !== undefined)
    body.AllowDirectPlay = changes.directPlay;
  if (changes.blockDirectAccess !== undefined)
    body.BlockNoneReferrer = changes.blockDirectAccess;
  if (changes.embedToken !== undefined)
    body.PlayerTokenAuthenticationEnabled = changes.embedToken;
  if (changes.cdnToken !== undefined)
    body.EnableTokenAuthentication = changes.cdnToken;
  if (changes.tokenIp !== undefined)
    body.EnableTokenIPVerification = changes.tokenIp;
  if (changes.drmBasic === true) {
    body.EnableDRM = true;
    body.DrmVersion = DRM_BASIC;
  } else if (changes.drmBasic === false) {
    body.EnableDRM = false;
  }
  return body;
}

const domain = z.string().trim().min(1);

export const ReferrerChangesSchema = z.strictObject({
  allow: z.array(domain).optional(),
  removeAllowed: z.array(domain).optional(),
  block: z.array(domain).optional(),
  removeBlocked: z.array(domain).optional(),
});
export type ReferrerChanges = z.infer<typeof ReferrerChangesSchema>;

export const REFERRER_ACTIONS = [
  "allow",
  "removeAllowed",
  "block",
  "removeBlocked",
] as const;
export type ReferrerAction = (typeof REFERRER_ACTIONS)[number];

export const ChangeResultSchema = z.object({
  change: z.string(),
  status: z.enum(["applied", "skipped", "failed", "notAttempted"]),
  error: z.string().optional(),
});
export type ChangeResult = z.infer<typeof ChangeResultSchema>;

/** Credential-free view of a video library used by the import tools: the library's own Stream key is never part of it. */
export const StreamLibrarySchema = z.object({
  id: z.number(),
  name: z.string(),
  videoCount: z.number(),
});

export type StreamLibrary = z.infer<typeof StreamLibrarySchema>;

export function toStreamLibrary(library: VideoLibraryModel): StreamLibrary {
  return {
    id: library.Id ?? 0,
    name: library.Name ?? "",
    videoCount: library.VideoCount ?? 0,
  };
}

/**
 * Premium encoding plans, as the dashboard's "Enable video library features"
 * step offers them. One plan or the other, never both. Picking one sends what
 * the dashboard sends to Add Video Library: EncodingTier 1 (Premium), the
 * plan's EnabledResolutions, AllowEarlyPlay (instant playback with
 * just-in-time encoding), and OutputCodecs, with H.264 (AVC) on by default.
 * The plan is the highest resolution enabled, which the per-minute price follows.
 */
export const PREMIUM_PLANS = {
  "1080p": {
    label: "1080p",
    pricePerMinute: 0.05,
    resolutions: ["240p", "360p", "480p", "720p", "1080p"],
  },
  "4k": {
    label: "4K",
    pricePerMinute: 0.15,
    resolutions: ["240p", "360p", "480p", "720p", "1080p", "1440p", "2160p"],
  },
} as const;
export type PremiumPlan = keyof typeof PREMIUM_PLANS;
export const PREMIUM_PLAN_CHOICES = Object.keys(PREMIUM_PLANS) as PremiumPlan[];

/** Output codecs by API name; H.264 is the only one free encoding produces. */
export const OUTPUT_CODECS = {
  x264: { label: "H.264 (AVC)", premium: false },
  av1: { label: "AV1", premium: true },
  hevc: { label: "H.265 (HEVC)", premium: true },
  vp9: { label: "VP9", premium: true },
} as const;

/**
 * Transcribing output languages (ISO 639-1), as documented at
 * https://bunny.net/docs/stream/transcribing#supported-languages-and-iso-639-1-language-codes.
 * The live list (`GET /videolibrary/languages`) is authoritative; this is the
 * fallback when it can't be fetched.
 */
export const TRANSCRIBING_LANGUAGES: ReadonlyArray<{
  code: string;
  name: string;
}> = [
  { name: "Arabic", code: "ar" },
  { name: "Armenian", code: "hy" },
  { name: "Azerbaijani", code: "az" },
  { name: "Belarusian", code: "be" },
  { name: "Bosnian", code: "bs" },
  { name: "Bulgarian", code: "bg" },
  { name: "Catalan", code: "ca" },
  { name: "Chinese", code: "zh" },
  { name: "Croatian", code: "hr" },
  { name: "Czech", code: "cs" },
  { name: "Danish", code: "da" },
  { name: "Dutch", code: "nl" },
  { name: "English", code: "en" },
  { name: "Estonian", code: "et" },
  { name: "Finnish", code: "fi" },
  { name: "French", code: "fr" },
  { name: "Galician", code: "gl" },
  { name: "German", code: "de" },
  { name: "Greek", code: "el" },
  { name: "Hebrew", code: "he" },
  { name: "Hindi", code: "hi" },
  { name: "Hungarian", code: "hu" },
  { name: "Icelandic", code: "is" },
  { name: "Indonesian", code: "id" },
  { name: "Italian", code: "it" },
  { name: "Japanese", code: "ja" },
  { name: "Kannada", code: "kn" },
  { name: "Kazakh", code: "kk" },
  { name: "Korean", code: "ko" },
  { name: "Latvian", code: "lv" },
  { name: "Lithuanian", code: "lt" },
  { name: "Macedonian", code: "mk" },
  { name: "Malay", code: "ms" },
  { name: "Maori", code: "mi" },
  { name: "Marathi", code: "mr" },
  { name: "Nepali", code: "ne" },
  { name: "Norwegian", code: "no" },
  { name: "Persian", code: "fa" },
  { name: "Polish", code: "pl" },
  { name: "Portuguese", code: "pt" },
  { name: "Romanian", code: "ro" },
  { name: "Russian", code: "ru" },
  { name: "Serbian", code: "sr" },
  { name: "Slovak", code: "sk" },
  { name: "Slovenian", code: "sl" },
  { name: "Spanish", code: "es" },
  { name: "Swahili", code: "sw" },
  { name: "Swedish", code: "sv" },
  { name: "Tagalog", code: "tl" },
  { name: "Tamil", code: "ta" },
  { name: "Thai", code: "th" },
  { name: "Turkish", code: "tr" },
  { name: "Ukrainian", code: "uk" },
  { name: "Urdu", code: "ur" },
  { name: "Vietnamese", code: "vi" },
  { name: "Welsh", code: "cy" },
];
export type OutputCodec = keyof typeof OUTPUT_CODECS;

/**
 * Premium encoding is billed by the highest resolution in the library's
 * ladder, per minute of encoded video and per output codec.
 */
export const PREMIUM_PRICE_TIERS = [
  {
    label: "1440p-2160p",
    resolutions: ["2160p", "1440p"],
    pricePerMinute: 0.15,
  },
  { label: "720p-1080p", resolutions: ["1080p", "720p"], pricePerMinute: 0.05 },
  {
    label: "240p-480p",
    resolutions: ["480p", "360p", "240p"],
    pricePerMinute: 0.025,
  },
] as const;

/** US dollars with cents, or tenths of a cent when the amount has them: $0.05, $0.025, $1.20. */
export function formatUsd(amount: number): string {
  const cents = amount * 100;
  const whole = Math.abs(Math.round(cents) - cents) < 1e-9;
  return `$${amount.toFixed(whole ? 2 : 3)}`;
}

/** "$0.15 (1440p-2160p), $0.05 (720p-1080p), $0.025 (240p-480p)". */
export const PREMIUM_PRICE_SUMMARY = PREMIUM_PRICE_TIERS.map(
  (t) => `$${t.pricePerMinute} (${t.label})`,
).join(", ");

/** The highest resolution enabled and the per-codec price it bills at; undefined for an empty ladder. */
export function premiumTierFor(
  resolutions: readonly string[],
): { top: string; pricePerMinute: number } | undefined {
  const enabled = new Set(resolutions.map((r) => r.trim().toLowerCase()));
  for (const tier of PREMIUM_PRICE_TIERS) {
    const top = tier.resolutions.find((r) => enabled.has(r));
    if (top) return { top, pricePerMinute: tier.pricePerMinute };
  }
  return undefined;
}

/**
 * What a premium plan costs per minute of encoded video: the plan's rate for
 * every output codec enabled, so two codecs on the 1080p plan cost $0.10/min.
 */
export function premiumRatePerMinute(
  plan: PremiumPlan,
  codecCount: number,
): number {
  return PREMIUM_PLANS[plan].pricePerMinute * Math.max(codecCount, 1);
}

/** Transcribing price per caption language per minute, in US dollars. */
export const TRANSCRIBING_PRICE_PER_MINUTE = 0.1;

export const LibraryFeaturesSchema = z
  .strictObject({
    premium: z
      .enum(PREMIUM_PLAN_CHOICES as [PremiumPlan, ...PremiumPlan[]])
      .optional()
      .describe(
        "Premium encoding plan, one of `1080p` ($0.05/min, up to 1080p) or `4k` ($0.15/min, up to 2160p). Adds encoding priority, AV1/H.265/VP9 and instant playback with just-in-time encoding (Early-Play, which exposes the originals). Left out: free encoding.",
      ),
    codecs: z
      .array(
        z.enum(Object.keys(OUTPUT_CODECS) as [OutputCodec, ...OutputCodec[]]),
      )
      .min(1)
      .optional()
      .describe(
        'Output codecs, e.g. `["x264", "av1"]`; all but x264 need a premium plan. With a plan, defaults to `["x264"]`.',
      ),
    transcribing: z
      .strictObject({
        languages: z
          .array(z.string().trim().min(2))
          .min(1)
          .describe(
            'Caption languages, ISO 639-1, e.g. `["en", "de"]`. The spoken language is detected.',
          ),
        title: z
          .boolean()
          .default(false)
          .describe("Smart generate: video titles."),
        description: z
          .boolean()
          .default(false)
          .describe("Smart generate: descriptions."),
        chapters: z
          .boolean()
          .default(false)
          .describe("Smart generate: chapters."),
        moments: z
          .boolean()
          .default(false)
          .describe("Smart generate: moments."),
      })
      .optional()
      .describe(
        "AI captions ($0.10/min per language), with smart generate included.",
      ),
  })
  .describe("Library features: premium encoding and transcribing.");
export type LibraryFeatures = z.input<typeof LibraryFeaturesSchema>;

/** The create/update body for a set of library features; empty when none were chosen. */
export function libraryFeaturesBody(
  features: LibraryFeatures | undefined,
): Pick<
  VideoLibraryUpdateModel,
  | "EncodingTier"
  | "EnabledResolutions"
  | "AllowEarlyPlay"
  | "OutputCodecs"
  | "EnableTranscribing"
  | "TranscribingCaptionLanguages"
  | "EnableTranscribingTitleGeneration"
  | "EnableTranscribingDescriptionGeneration"
  | "EnableTranscribingChaptersGeneration"
  | "EnableTranscribingMomentsGeneration"
> {
  if (!features) return {};
  const codecs = features.codecs ?? [];
  const premiumCodecs = codecs.filter((codec) => OUTPUT_CODECS[codec].premium);
  if (!features.premium && premiumCodecs.length > 0) {
    throw new UserError(
      `${premiumCodecs.map((c) => OUTPUT_CODECS[c].label).join(", ")} need premium encoding.`,
      "Choose a premium plan (1080p or 4K), or keep H.264 only.",
    );
  }
  const body: ReturnType<typeof libraryFeaturesBody> = {};
  if (features.premium) {
    body.EncodingTier = 1;
    body.EnabledResolutions =
      PREMIUM_PLANS[features.premium].resolutions.join(",");
    body.AllowEarlyPlay = true;
    // AVC is on by default, as in the dashboard.
    body.OutputCodecs = [...new Set(codecs.length ? codecs : ["x264"])].join(
      ",",
    );
  } else if (codecs.length > 0) {
    body.OutputCodecs = [...new Set(codecs)].join(",");
  }
  const t = features.transcribing;
  if (t) {
    body.EnableTranscribing = true;
    body.TranscribingCaptionLanguages = [
      ...new Set(t.languages.map((l) => l.toLowerCase())),
    ];
    body.EnableTranscribingTitleGeneration = t.title ?? false;
    body.EnableTranscribingDescriptionGeneration = t.description ?? false;
    body.EnableTranscribingChaptersGeneration = t.chapters ?? false;
    body.EnableTranscribingMomentsGeneration = t.moments ?? false;
  }
  return body;
}
