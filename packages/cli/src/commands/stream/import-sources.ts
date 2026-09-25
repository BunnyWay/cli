import type { SourcePlugin } from "@bunny.net/stream-import";
import { brightcoveSource } from "@bunny.net/stream-import-brightcove";
import { cloudflareSource } from "@bunny.net/stream-import-cloudflare";
import { jwplayerSource } from "@bunny.net/stream-import-jwplayer";
import { muxSource } from "@bunny.net/stream-import-mux";
import { s3Source } from "@bunny.net/stream-import-s3";
import { vimeoSource } from "@bunny.net/stream-import-vimeo";
import { wistiaSource } from "@bunny.net/stream-import-wistia";
import { UserError } from "@/core/errors.ts";

/** The CLI's only per-source knowledge: `--source` choices, prompts, and env resolution all derive from this list. */
export const SOURCES: SourcePlugin[] = [
  vimeoSource,
  s3Source,
  wistiaSource,
  muxSource,
  cloudflareSource,
  jwplayerSource,
  brightcoveSource,
];

export const SOURCE_IDS: string[] = SOURCES.map((s) => s.id);

export function findSource(id: string): SourcePlugin | undefined {
  return SOURCES.find((s) => s.id === id);
}

export function requireSource(id: string | undefined): SourcePlugin {
  if (!id) {
    throw new UserError(
      "No source selected.",
      `Pass --source <${SOURCE_IDS.join("|")}>.`,
    );
  }

  const plugin = findSource(id);
  if (!plugin) {
    throw new UserError(
      `Unknown source: ${id}`,
      `Available sources: ${SOURCE_IDS.join(", ")}.`,
    );
  }

  return plugin;
}

// Greedy word wrap with a hanging indent, so yargs (which wraps at 80 columns with no indent) leaves the lines alone.
function wrap(words: string[], indent: number, width = 78): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && indent + line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i === 0 ? l : `${" ".repeat(indent)}${l}`));
}

/** The `--help` epilogue: each source's credential variables, generated from the registry so it cannot drift. */
export function credentialsHelp(): string {
  const width = Math.max(...SOURCE_IDS.map((id) => id.length)) + 2;
  const names = (fields: SourcePlugin["credentials"]) =>
    fields.map((f) => [f.env, ...(f.fallbackEnv ?? [])].join(" or "));
  const lines = SOURCES.flatMap((plugin) => {
    const required = names(plugin.credentials.filter((f) => f.required));
    const optional = names(plugin.credentials.filter((f) => !f.required));
    const words = [
      ...required.map((n, i) => (i < required.length - 1 ? `${n},` : n)),
      ...(optional.length
        ? [
            "(optional:",
            ...optional.map((n, i) =>
              i < optional.length - 1 ? `${n},` : `${n})`,
            ),
          ]
        : []),
    ];
    return `  ${plugin.id.padEnd(width)}${wrap(words, width + 2).join("\n")}`;
  });
  return [
    "Source credentials are read from these environment variables:",
    ...lines,
  ].join("\n");
}
