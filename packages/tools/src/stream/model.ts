import { UserError } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/core";
import { z } from "zod";

export type VideoLibraryModel = components["schemas"]["VideoLibraryModel"];
export type VideoLibraryUpdateModel =
  components["schemas"]["VideoLibraryUpdateModel"];
export type VideoLibraryLanguageModel =
  components["schemas"]["VideoLibraryLanguage"];

// ---------------------------------------------------------------------------
// Libraries
// ---------------------------------------------------------------------------

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

/** Replication regions a new library gets when none are named (DE is added as the main region). */
export const DEFAULT_REPLICATION_REGIONS: readonly string[] = [
  "SG",
  "LA",
  "NY",
];

/**
 * Normalize region codes for `ReplicationRegions` / `ReplicationZones`:
 * upper-case, validated against {@link REGION_CODES}, deduplicated, and with
 * the main region (`DE`) dropped because it is never a replication zone.
 */
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

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

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

/** Throw when any code isn't in the list for the given use. */
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

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

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

/** Map player changes onto the sparse update body. */
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

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

const DRM_VERSIONS = { 0: "basic", 1: "enterprise", 2: "basicV2" } as const;
/** `DrmVersion` value for MediaCage Basic DRM. */
export const DRM_BASIC = 0;
/** `DrmVersion` value for MediaCage Enterprise DRM, which the tools never switch on or off. */
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
