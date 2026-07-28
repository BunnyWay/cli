/** Default directory holding migration files, relative to the working directory. */
export const DEFAULT_MIGRATIONS_DIR = "migrations";

/** Directories checked when `--dir` is omitted and the default doesn't exist. */
export const FALLBACK_MIGRATIONS_DIRS = ["drizzle"] as const;

/** Table recording applied migrations. The `__` prefix keeps it out of studio and REST introspection. */
export const MIGRATIONS_TABLE = "__bunny_migrations";

/** Flag name for overriding the migrations directory. */
export const ARG_DIR = "dir";
