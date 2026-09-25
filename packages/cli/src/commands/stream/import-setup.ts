import {
  type CredentialField,
  missingCredentials,
  resolveSourceConfig,
  type SourcePlugin,
} from "@bunny.net/stream-import";
import { extendToolContext, type ToolContext } from "@bunny.net/tools";
import {
  requireSource,
  SOURCE_IDS,
  streamImportSources,
} from "@bunny.net/tools/stream";
import { bunny } from "@/core/colors.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import { isInteractive, prompts, withSpinner } from "@/core/ui.ts";

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

// `--source` wins, then the only source whose credentials are all in the environment, then a picker.
export async function resolveImportSource(
  ctx: ToolContext,
  requested: string | undefined,
  output: OutputFormat,
): Promise<SourcePlugin> {
  if (requested) return requireSource(requested);

  const sources = await streamImportSources.run(ctx, {});
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

/** Prompts, interactively, for required credentials that neither a flag nor the environment sets; returns them as env overrides for this run only. */
export async function promptSourceCredentials(
  plugin: SourcePlugin,
  overrides: Record<string, string | number | undefined>,
  output: OutputFormat,
): Promise<Record<string, string>> {
  const resolved = resolveSourceConfig(plugin, { overrides });
  if (
    missingCredentials(plugin, resolved).length === 0 ||
    !isInteractive(output)
  ) {
    return {};
  }

  const explicit = resolveSourceConfig(plugin, {
    overrides,
    includeDefaults: false,
  });
  const toPrompt = plugin.credentials.filter(
    (f) => f.required && explicit[f.key] === undefined,
  );
  // What is left is a bad combination of set values, which a prompt cannot fix; the tool names it.
  if (toPrompt.length === 0) return {};

  logger.log(bunny.bold(`${plugin.label} credentials`));
  const entered: Record<string, string> = {};
  for (const field of toPrompt) {
    entered[field.env] = await promptCredential(field);
  }
  const required = plugin.credentials.filter((f) => f.required);
  logger.dim(
    `Set ${required.map((f) => f.env).join(", ")} to skip these prompts next time.`,
  );

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
