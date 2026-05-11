import { CURRENT_VERSION } from "./schema.ts";

/**
 * Migration functions transform a raw config object (post-JSONC parse,
 * pre-Zod validation) from one version to the next.
 *
 * Add a new entry whenever the shape changes. Each migration receives
 * the previous shape and returns the next. The runner applies them
 * in order until the config reaches `CURRENT_VERSION`.
 */
type Migration = {
  from: string;
  to: string;
  apply: (raw: any) => any;
};

const MIGRATIONS: Migration[] = [
  {
    // Pre-versioned configs (no `version` field) → tag as the first version.
    // The pre-versioned shape had no breaking differences from the first
    // versioned one, so this is a no-op tag.
    from: "0",
    to: "2026-05-11",
    apply: (raw) => ({ version: "2026-05-11", ...raw }),
  },
];

/**
 * Migrate a raw parsed config to the current version. Returns a tuple of
 * `[migrated, migratedFrom]` so callers can log when a migration happened.
 */
export function migrate(raw: any): {
  config: any;
  migratedFrom: string | null;
} {
  if (typeof raw !== "object" || raw === null) {
    return { config: raw, migratedFrom: null };
  }

  const originalVersion: string = raw.version ?? "0";
  let cfg = raw;
  let current = originalVersion;

  while (current !== CURRENT_VERSION) {
    const next = MIGRATIONS.find((m) => m.from === current);
    if (!next) break; // No migration path — let Zod surface the validation error.
    cfg = next.apply(cfg);
    current = next.to;
  }

  return {
    config: cfg,
    migratedFrom: originalVersion === CURRENT_VERSION ? null : originalVersion,
  };
}
