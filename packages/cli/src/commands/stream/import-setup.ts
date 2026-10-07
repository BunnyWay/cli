import {
  assertFolderSupported,
  type CredentialField,
  missingCredentials,
  parseSourceConfig,
  resolveSourceConfig,
  type SourcePlugin,
} from "@bunny.net/stream-import";
import { extendToolContext, type ToolContext } from "@bunny.net/tools";
import {
  requireSource,
  SOURCE_IDS,
  SOURCES,
  SourceCredentialsError,
  StateHomeError,
  streamImportSources,
} from "@bunny.net/tools/stream";
import {
  deleteImportCredentials,
  getImportCredentials,
  setImportCredentials,
} from "@/config/index.ts";
import { bunny } from "@/core/colors.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import { confirm, isInteractive, prompts, withSpinner } from "@/core/ui.ts";

/** Reword an import tool error whose hint names the tool context's env; undefined leaves the error as it is. */
export function cliImportError(error: unknown): Error | undefined {
  if (error instanceof StateHomeError)
    return new UserError(error.message, "Set XDG_STATE_HOME or HOME.");
  return undefined;
}

/** Run one tool call under its own spinner, which the tool's progress messages steer. */
export function withToolSpinner<T>(
  ctx: ToolContext,
  text: string,
  fn: (ctx: ToolContext) => Promise<T>,
): Promise<T> {
  return withSpinner(text, (spin) =>
    fn(
      extendToolContext(ctx, {
        onProgress: (message) => {
          spin.text = message;
        },
      }),
    ),
  );
}

export interface SavedCredentials {
  /** The tool context with saved values filling the variables the environment leaves unset. */
  ctx: ToolContext;
  /** Per source, the saved values that were actually used. */
  used: Map<string, Record<string, string>>;
}

/** Layer the profile's saved import credentials under the real environment, which always wins. */
export function withSavedCredentials(
  ctx: ToolContext,
  profile: string,
): SavedCredentials {
  const env: Record<string, string> = {};
  const used = new Map<string, Record<string, string>>();
  for (const plugin of SOURCES) {
    const filled: Record<string, string> = {};
    for (const [name, value] of Object.entries(
      getImportCredentials(profile, plugin.id),
    )) {
      if (!ctx.env[name]) filled[name] = value;
    }
    if (Object.keys(filled).length === 0) continue;
    Object.assign(env, filled);
    used.set(plugin.id, filled);
  }

  return { ctx: extendToolContext(ctx, { env }), used };
}

/** After the source accepted them, offer to keep what was typed so later runs (and `--resume`) skip the prompts. */
export async function offerToSaveCredentials(
  plugin: SourcePlugin,
  entered: Record<string, string>,
  profile: string,
): Promise<void> {
  if (Object.keys(entered).length === 0) return;
  const save = await confirm(
    `Save ${plugin.label} credentials for next time?`,
    {
      initial: true,
      optional: true,
    },
  );
  if (!save) {
    const required = plugin.credentials.filter((f) => f.required);
    logger.dim(
      `Set ${required.map((f) => f.env).join(", ")} to skip these prompts next time.`,
    );

    return;
  }
  setImportCredentials(profile, plugin.id, {
    ...getImportCredentials(profile, plugin.id),
    ...entered,
  });
  logger.success(
    `Saved ${plugin.label} credentials to the "${profile}" profile.`,
  );
}

// `--source` wins, then the only source whose credentials are all in the environment, then a picker.
export async function resolveImportSource(
  ctx: ToolContext,
  requested: string | undefined,
  output: OutputFormat,
): Promise<SourcePlugin> {
  if (requested) return requireSource(requested);

  const sources = await streamImportSources.invoke(ctx, {});
  const ready = sources.filter((s) => s.readiness === "ready");
  if (ready.length === 1 && ready[0]) {
    logger.info(
      `Importing from ${ready[0].label}, the only source configured.`,
    );

    return requireSource(ready[0].id);
  }

  if (!isInteractive(output)) {
    throw new UserError(
      "No source selected.",
      `Pass --source <${SOURCE_IDS.join("|")}>.`,
    );
  }

  const { id } = await prompts({
    type: "select",
    name: "id",
    message: "Where are the videos coming from?",
    choices: sources.map((source) => ({
      title:
        source.readiness === "ready"
          ? `${source.label} (configured)`
          : source.label,
      value: source.id,
    })),
  });
  if (id === undefined) throw new UserError("A source is required.");

  return requireSource(id);
}

/** Prompts, interactively, for required credentials that neither a flag nor the tool context's env sets; returns them as env overrides for this run only. */
export async function promptSourceCredentials(
  ctx: ToolContext,
  plugin: SourcePlugin,
  overrides: Record<string, string | number | undefined>,
  output: OutputFormat,
): Promise<Record<string, string>> {
  const { env } = ctx;
  const entered = isInteractive(output)
    ? await promptMissing(plugin, env, overrides)
    : {};
  // Validated here so a bad value fails with the CLI's wording rather than the tool's host-neutral one.
  parseSourceConfig(
    plugin,
    resolveSourceConfig(plugin, { env: { ...env, ...entered }, overrides }),
  );
  return entered;
}

async function promptMissing(
  plugin: SourcePlugin,
  env: ToolContext["env"],
  overrides: Record<string, string | number | undefined>,
): Promise<Record<string, string>> {
  const resolved = resolveSourceConfig(plugin, { env, overrides });
  if (missingCredentials(plugin, resolved).length === 0) return {};
  const explicit = resolveSourceConfig(plugin, {
    env,
    overrides,
    includeDefaults: false,
  });
  const toPrompt = plugin.credentials.filter(
    (f) => f.required && explicit[f.key] === undefined,
  );
  // What is left is a bad combination of set values, which a prompt cannot fix.
  if (toPrompt.length === 0) return {};

  logger.log(bunny.bold(`${plugin.label} credentials`));
  const entered: Record<string, string> = {};
  for (const field of toPrompt) {
    entered[field.env] = await promptCredential(field);
  }

  return entered;
}

async function promptCredential(field: CredentialField): Promise<string> {
  if (field.hint) logger.dim(`  ${field.hint}`);
  const { value } = await prompts({
    type: field.secret ? "password" : "text",
    name: "value",
    message: `${field.label}:`,
    initial:
      field.secret || field.default === undefined
        ? undefined
        : String(field.default),
  });
  if (value === undefined) throw new UserError("Cancelled.");
  const trimmed = String(value).trim();
  if (trimmed) return trimmed;
  if (field.default !== undefined) return String(field.default);
  throw new UserError(`${field.label} is required.`);
}

export interface ImportSourceArgs {
  profile: string;
  source?: string;
  folder?: string;
  bucket?: string;
  prefix?: string;
  urlTtl?: number;
}

/** Settle the source and its credentials, then run one tool call with them; saved credentials the source rejects are dropped, and typed ones offered for saving once it accepts them. */
export async function withImportSource<T>(
  baseCtx: ToolContext,
  args: ImportSourceArgs,
  output: OutputFormat,
  spinnerText: string,
  fn: (ctx: ToolContext, plugin: SourcePlugin) => Promise<T>,
): Promise<{ plugin: SourcePlugin; env: Record<string, string>; result: T }> {
  const saved = withSavedCredentials(baseCtx, args.profile);
  const plugin = await resolveImportSource(saved.ctx, args.source, output);
  if (!args.source) assertFolderSupported(plugin, args.folder);
  const usedSaved = saved.used.get(plugin.id) ?? {};
  const entered = await promptSourceCredentials(
    saved.ctx,
    plugin,
    { bucket: args.bucket, prefix: args.prefix, presignedUrlTtl: args.urlTtl },
    output,
  );
  // Saved values travel in `env` alongside what was typed, layered over the base context.
  const env = { ...usedSaved, ...entered };
  const result = await withToolSpinner(
    extendToolContext(baseCtx, { env }),
    spinnerText,
    (ctx) => fn(ctx, plugin),
  ).catch((error) => {
    // Timeouts and outages keep saved values; only a rejection drops them, so the next run prompts instead of failing the same way.
    if (
      Object.keys(usedSaved).length > 0 &&
      error instanceof SourceCredentialsError
    ) {
      deleteImportCredentials(args.profile, plugin.id);
      logger.warn(
        `Removed the saved ${plugin.label} credentials. Run again to enter new ones.`,
      );
    }
    throw cliImportError(error) ?? error;
  });
  await offerToSaveCredentials(plugin, entered, args.profile);

  return { plugin, env, result };
}
