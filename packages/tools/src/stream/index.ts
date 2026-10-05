import { ApiError, UserError } from "@bunny.net/openapi-client";
import { z } from "zod";
import type { CoreClient } from "../context.ts";
import type { Tool } from "../define-tool.ts";
import { defineTool } from "../define-tool.ts";
import {
  allRegions,
  assertLanguages,
  type ChangeResult,
  ChangeResultSchema,
  DRM_ENTERPRISE,
  type Language,
  LanguageSchema,
  type LibrarySummary,
  LibrarySummarySchema,
  MAIN_REGION,
  PlayerChangesSchema,
  type PlayerSettings,
  PlayerSettingsSchema,
  type PullZoneSecurity,
  parseReplicationRegions,
  playerUpdateBody,
  REFERRER_ACTIONS,
  type ReferrerAction,
  ReferrerChangesSchema,
  SecurityChangesSchema,
  type SecuritySettings,
  SecuritySettingsSchema,
  securityUpdateBody,
  toLanguage,
  toLibrarySummary,
  toPlayerSettings,
  toSecuritySettings,
  type VideoLibraryModel,
  type VideoLibraryUpdateModel,
} from "./model.ts";

export * from "./model.ts";

const libraryId = z
  .number()
  .int()
  .positive()
  .describe("Video library ID, e.g. `12345`.");

// ---------------------------------------------------------------------------
// Shared fetches
// ---------------------------------------------------------------------------

export async function fetchLibraryModel(
  client: CoreClient,
  id: number,
  signal?: AbortSignal,
): Promise<VideoLibraryModel> {
  try {
    const { data } = await client.GET("/videolibrary/{id}", {
      params: { path: { id } },
      signal,
    });
    if (data) return data;
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
  }
  throw new UserError(`Video library ${id} not found.`);
}

async function fetchAllLibraries(
  client: CoreClient,
  signal?: AbortSignal,
  search?: string,
): Promise<VideoLibraryModel[]> {
  const libraries: VideoLibraryModel[] = [];
  // page must be >= 1: page 0 returns a bare array instead of the paginated envelope.
  for (let page = 1; ; page++) {
    const { data } = await client.GET("/videolibrary", {
      params: { query: { page, perPage: 1000, search } },
      signal,
    });
    libraries.push(...(data?.Items ?? []));
    if (!data?.HasMoreItems) break;
  }
  return libraries;
}

async function fetchPullZoneSecurity(
  client: CoreClient,
  library: VideoLibraryModel,
  signal?: AbortSignal,
): Promise<(PullZoneSecurity & { ZoneSecurityKey?: string | null }) | null> {
  if (!library.PullZoneId) return null;
  const { data } = await client.GET("/pullzone/{id}", {
    params: { path: { id: library.PullZoneId } },
    signal,
  });
  return data ?? null;
}

async function updateLibrary(
  client: CoreClient,
  id: number,
  body: VideoLibraryUpdateModel,
  signal?: AbortSignal,
): Promise<VideoLibraryModel> {
  const { data } = await client.POST("/videolibrary/{id}", {
    params: { path: { id } },
    body,
    signal,
  });
  return data ?? fetchLibraryModel(client, id, signal);
}

async function fetchLanguages(
  client: CoreClient,
  signal?: AbortSignal,
): Promise<Language[]> {
  const { data } = await client.GET("/videolibrary/languages", { signal });
  return (data ?? [])
    .map(toLanguage)
    .filter((language) => language.code)
    .sort((a, b) => a.code.localeCompare(b.code));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Libraries
// ---------------------------------------------------------------------------

export const streamLibrariesList = defineTool({
  name: "stream.libraries.list",
  title: "List video libraries",
  description:
    "List the account's Stream video libraries, sorted by name, with their storage regions.",
  schema: z.strictObject({}),
  kind: "read",
  resultSchema: z.array(LibrarySummarySchema),
  run: async (ctx): Promise<LibrarySummary[]> => {
    ctx.progress("Fetching video libraries...");
    const libraries = await fetchAllLibraries(ctx.clients.core, ctx.signal);
    return libraries
      .map(toLibrarySummary)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const streamLibrariesResolve = defineTool({
  name: "stream.libraries.resolve",
  title: "Resolve a video library",
  description:
    "Find one video library by numeric ID or exact name (case-insensitive).",
  schema: z.strictObject({
    library: z
      .string()
      .trim()
      .min(1)
      .describe("Library ID or name, e.g. `12345` or `my-library`."),
  }),
  kind: "read",
  resultSchema: LibrarySummarySchema,
  examples: [[{ library: "my-library" }, "Resolve a library by name"]],
  run: async (ctx, { library }): Promise<LibrarySummary> => {
    ctx.progress("Resolving video library...");
    if (/^\d+$/.test(library)) {
      return toLibrarySummary(
        await fetchLibraryModel(ctx.clients.core, Number(library), ctx.signal),
      );
    }
    const matches = await fetchAllLibraries(
      ctx.clients.core,
      ctx.signal,
      library,
    );
    const match = matches.find(
      (lib) => (lib.Name ?? "").toLowerCase() === library.toLowerCase(),
    );
    if (!match) {
      throw new UserError(
        `No video library found for "${library}".`,
        'Run "bunny stream library list" to see your libraries.',
      );
    }
    return toLibrarySummary(match);
  },
});

export const AddRegionsResultSchema = z.object({
  library: z.number(),
  storageZoneId: z.number(),
  added: z.array(z.string()),
  regions: z.array(z.string()),
});
export type AddRegionsResult = z.infer<typeof AddRegionsResultSchema>;

export const streamLibrariesAddRegions = defineTool({
  name: "stream.libraries.addregions",
  title: "Add replication regions",
  description: `Add replication regions to a video library's storage. Regions can only be added, never removed, and ${MAIN_REGION} always stays the main region. Sends the existing regions plus the new ones, and sends nothing when every region is already enabled.`,
  schema: z.strictObject({
    library: libraryId,
    regions: z
      .array(z.string())
      .min(1)
      .describe('Region codes to add, e.g. `["SYD"]`.'),
  }),
  kind: "write",
  resultSchema: AddRegionsResultSchema,
  examples: [[{ library: 12345, regions: ["SYD"] }, "Replicate to Sydney too"]],
  run: async (ctx, { library, regions }): Promise<AddRegionsResult> => {
    const requested = parseReplicationRegions(regions);
    ctx.progress("Fetching video library...");
    const lib = await fetchLibraryModel(ctx.clients.core, library, ctx.signal);
    if (!lib.StorageZoneId) {
      throw new UserError(
        `Video library ${library} has no storage zone to replicate.`,
      );
    }
    const current = (lib.ReplicationRegions ?? [])
      .map((r) => r.toUpperCase())
      .filter((r) => r !== MAIN_REGION);
    const added = requested.filter((r) => !current.includes(r));
    const merged = [...current, ...added];

    if (added.length > 0) {
      ctx.progress("Adding replication regions...");
      await ctx.clients.core.POST("/storagezone/{id}", {
        params: { path: { id: lib.StorageZoneId } },
        body: { ReplicationZones: merged },
        signal: ctx.signal,
      });
    }

    return {
      library,
      storageZoneId: lib.StorageZoneId,
      added,
      regions: allRegions(merged),
    };
  },
});

export const RotatedKeySchema = z.object({
  library: z.number(),
  readOnly: z.boolean(),
  apiKey: z.string(),
});
export type RotatedKey = z.infer<typeof RotatedKeySchema>;

export const streamLibrariesRotateKey = defineTool({
  name: "stream.libraries.rotatekey",
  title: "Rotate a library API key",
  description:
    "Reset a video library's Stream API key (or its read-only key) and return the new one. Anything still using the old key stops working.",
  schema: z.strictObject({
    library: libraryId,
    readOnly: z
      .boolean()
      .default(false)
      .describe("Rotate the read-only key instead of the read-write key."),
  }),
  kind: "destructive",
  sensitive: true,
  resultSchema: RotatedKeySchema,
  run: async (ctx, { library, readOnly }): Promise<RotatedKey> => {
    ctx.progress("Rotating API key...");
    const path = readOnly
      ? "/videolibrary/{id}/resetReadOnlyApiKey"
      : "/videolibrary/{id}/resetApiKey";
    await ctx.clients.core.POST(path, {
      params: { path: { id: library } },
      signal: ctx.signal,
    });
    // The reset endpoints only report success, so read the new key back.
    ctx.progress("Fetching the new key...");
    const lib = await fetchLibraryModel(ctx.clients.core, library, ctx.signal);
    const apiKey = readOnly ? lib.ReadOnlyApiKey : lib.ApiKey;
    if (!apiKey) {
      throw new UserError(
        `The key was reset, but the new ${readOnly ? "read-only " : ""}key for video library ${library} could not be read.`,
        "Run `bunny stream library credentials` to retrieve it.",
      );
    }
    return { library, readOnly, apiKey };
  },
});

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

export const streamLanguagesList = defineTool({
  name: "stream.languages.list",
  title: "List Stream languages",
  description:
    "List the languages Stream supports, marking which work as the player UI language and which as transcription output.",
  schema: z.strictObject({}),
  kind: "read",
  resultSchema: z.array(LanguageSchema),
  run: async (ctx): Promise<Language[]> => {
    ctx.progress("Fetching languages...");
    return fetchLanguages(ctx.clients.core, ctx.signal);
  },
});

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export const streamPlayerGet = defineTool({
  name: "stream.player.get",
  title: "Get player settings",
  description: "Get a video library's Bunny Player settings.",
  schema: z.strictObject({ library: libraryId }),
  kind: "read",
  resultSchema: PlayerSettingsSchema,
  run: async (ctx, { library }): Promise<PlayerSettings> => {
    ctx.progress("Fetching player settings...");
    return toPlayerSettings(
      await fetchLibraryModel(ctx.clients.core, library, ctx.signal),
    );
  },
});

export const streamPlayerUpdate = defineTool({
  name: "stream.player.update",
  title: "Update player settings",
  description:
    "Change a video library's Bunny Player settings. Only the settings given are sent. `controls: false` turns every control off; the UI language is checked against the supported list.",
  schema: z.strictObject({
    library: libraryId,
    changes: PlayerChangesSchema,
  }),
  kind: "write",
  resultSchema: PlayerSettingsSchema,
  examples: [
    [
      { library: 12345, changes: { color: "#FF7755", heatmap: true } },
      "Set the key colour and show the heatmap",
    ],
  ],
  run: async (ctx, { library, changes }): Promise<PlayerSettings> => {
    const body = playerUpdateBody(changes);
    if (Object.keys(body).length === 0) {
      throw new UserError("No player changes requested.");
    }
    if (changes.language !== undefined) {
      ctx.progress("Checking the UI language...");
      assertLanguages(
        [changes.language],
        await fetchLanguages(ctx.clients.core, ctx.signal),
        "player",
      );
    }
    ctx.progress("Updating player settings...");
    return toPlayerSettings(
      await updateLibrary(ctx.clients.core, library, body, ctx.signal),
    );
  },
});

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

export const streamSecurityGet = defineTool({
  name: "stream.security.get",
  title: "Get security settings",
  description:
    "Get a video library's security settings. CDN token state comes from the linked Pull Zone, since the library doesn't return it. Never includes the token key.",
  schema: z.strictObject({ library: libraryId }),
  kind: "read",
  resultSchema: SecuritySettingsSchema,
  run: async (ctx, { library }): Promise<SecuritySettings> => {
    ctx.progress("Fetching security settings...");
    const lib = await fetchLibraryModel(ctx.clients.core, library, ctx.signal);
    const zone = await fetchPullZoneSecurity(ctx.clients.core, lib, ctx.signal);
    return toSecuritySettings(lib, zone);
  },
});

export const SecurityUpdateResultSchema = z.object({
  library: z.number(),
  /** True when every requested change landed (or was already in place). */
  complete: z.boolean(),
  changes: z.array(ChangeResultSchema),
});
export type SecurityUpdateResult = z.infer<typeof SecurityUpdateResultSchema>;

const ACTION_ENDPOINTS = {
  allow: "/videolibrary/{id}/addAllowedReferrer",
  removeAllowed: "/videolibrary/{id}/removeAllowedReferrer",
  block: "/videolibrary/{id}/addBlockedReferrer",
  removeBlocked: "/videolibrary/{id}/removeBlockedReferrer",
} as const;

const ACTION_LABELS: Record<ReferrerAction, string> = {
  allow: "allow",
  removeAllowed: "remove allowed",
  block: "block",
  removeBlocked: "remove blocked",
};

export const streamSecurityUpdate = defineTool({
  name: "stream.security.update",
  title: "Update security settings",
  description:
    "Change a video library's security settings and domain lists. Settings go in one update, then each domain change is its own call; changes already in place are skipped, and the first failure stops the run and is reported change by change. Basic DRM only: a library on Enterprise DRM is refused.",
  schema: z.strictObject({
    library: libraryId,
    settings: SecurityChangesSchema.default({}),
    referrers: ReferrerChangesSchema.default({}),
  }),
  kind: "write",
  resultSchema: SecurityUpdateResultSchema,
  examples: [
    [
      {
        library: 12345,
        settings: { embedToken: true },
        referrers: { allow: ["example.com"] },
      },
      "Require embed tokens and allow one domain",
    ],
  ],
  run: async (
    ctx,
    { library, settings, referrers },
  ): Promise<SecurityUpdateResult> => {
    const body = securityUpdateBody(settings);
    const planned = REFERRER_ACTIONS.flatMap((action) =>
      [...new Set(referrers[action] ?? [])].map((domain) => ({
        action,
        domain,
      })),
    );
    if (Object.keys(body).length === 0 && planned.length === 0) {
      throw new UserError("No security changes requested.");
    }

    ctx.progress("Fetching video library...");
    const lib = await fetchLibraryModel(ctx.clients.core, library, ctx.signal);

    if (settings.drmBasic !== undefined && lib.DrmVersion === DRM_ENTERPRISE) {
      throw new UserError(
        `Video library ${library} uses MediaCage Enterprise DRM, which the CLI doesn't manage.`,
        "Change DRM for this library in the bunny.net dashboard.",
      );
    }

    const changes: ChangeResult[] = [];
    if (Object.keys(body).length > 0) {
      ctx.progress("Updating security settings...");
      await updateLibrary(ctx.clients.core, library, body, ctx.signal);
      changes.push({
        change: `settings (${Object.keys(body).join(", ")})`,
        status: "applied",
      });
    }

    const lists = {
      allowed: new Set(
        (lib.AllowedReferrers ?? []).map((d) => d.toLowerCase()),
      ),
      blocked: new Set(
        (lib.BlockedReferrers ?? []).map((d) => d.toLowerCase()),
      ),
    };
    let failed = false;
    for (const { action, domain } of planned) {
      const change = `${ACTION_LABELS[action]} ${domain}`;
      if (failed) {
        changes.push({ change, status: "notAttempted" });
        continue;
      }
      const list =
        action === "allow" || action === "removeAllowed"
          ? lists.allowed
          : lists.blocked;
      const adding = action === "allow" || action === "block";
      const key = domain.toLowerCase();
      if (adding === list.has(key)) {
        changes.push({ change, status: "skipped" });
        continue;
      }
      try {
        ctx.progress(`Updating domains (${change})...`);
        await ctx.clients.core.POST(ACTION_ENDPOINTS[action], {
          params: { path: { id: library } },
          body: { Hostname: domain },
          signal: ctx.signal,
        });
        if (adding) list.add(key);
        else list.delete(key);
        changes.push({ change, status: "applied" });
      } catch (err) {
        failed = true;
        changes.push({ change, status: "failed", error: errorMessage(err) });
      }
    }

    return { library, complete: !failed, changes };
  },
});

export const ResetTokenResultSchema = z.object({
  library: z.number(),
  reset: z.literal(true),
});
export type ResetTokenResult = z.infer<typeof ResetTokenResultSchema>;

export const streamSecurityResetToken = defineTool({
  name: "stream.security.resettoken",
  title: "Reset the token authentication key",
  description:
    "Rotate a video library's CDN and embed view token key. Every signed URL issued with the old key stops working.",
  schema: z.strictObject({ library: libraryId }),
  kind: "destructive",
  resultSchema: ResetTokenResultSchema,
  run: async (ctx, { library }): Promise<ResetTokenResult> => {
    ctx.progress("Resetting the token key...");
    await updateLibrary(
      ctx.clients.core,
      library,
      { ResetToken: true },
      ctx.signal,
    );
    return { library, reset: true };
  },
});

export const TokenKeySchema = z.object({
  library: z.number(),
  pullZoneId: z.number(),
  key: z.string(),
});
export type TokenKey = z.infer<typeof TokenKeySchema>;

export const streamSecurityTokenKey = defineTool({
  name: "stream.security.tokenkey",
  title: "Get the token authentication key",
  description:
    "Get a video library's token authentication key, used to sign embed view and CDN URLs. It lives on the linked Pull Zone as `ZoneSecurityKey`.",
  schema: z.strictObject({ library: libraryId }),
  kind: "read",
  sensitive: true,
  resultSchema: TokenKeySchema,
  run: async (ctx, { library }): Promise<TokenKey> => {
    ctx.progress("Fetching the token key...");
    const lib = await fetchLibraryModel(ctx.clients.core, library, ctx.signal);
    const zone = await fetchPullZoneSecurity(ctx.clients.core, lib, ctx.signal);
    if (!zone?.ZoneSecurityKey || !lib.PullZoneId) {
      throw new UserError(
        `No token authentication key found for video library ${library}.`,
        "Check the library's Security settings in the bunny.net dashboard.",
      );
    }
    return { library, pullZoneId: lib.PullZoneId, key: zone.ZoneSecurityKey };
  },
});

export const streamTools: Tool[] = [
  streamLibrariesList,
  streamLibrariesResolve,
  streamLibrariesAddRegions,
  streamLibrariesRotateKey,
  streamLanguagesList,
  streamPlayerGet,
  streamPlayerUpdate,
  streamSecurityGet,
  streamSecurityUpdate,
  streamSecurityResetToken,
  streamSecurityTokenKey,
];
