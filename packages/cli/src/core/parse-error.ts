import type { Argv } from "yargs";

// These runtime APIs are present in yargs 18 but absent from @types/yargs 17.
interface ParserContext extends Argv {
  getOptions(): {
    key: Record<string, unknown>;
    alias: Record<string, string[]>;
  };
  getInternalMethods(): { getContext(): { commands: string[] } };
}

function closestMatch(input: string, choices: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Math.min(2, Math.floor(input.length / 2)) + 1;
  for (const choice of choices) {
    let row = Array.from({ length: choice.length + 1 }, (_, i) => i);
    for (let i = 0; i < input.length; i++) {
      const next = [i + 1];
      for (let j = 0; j < choice.length; j++) {
        next.push(
          Math.min(
            (next[j] ?? 0) + 1,
            (row[j + 1] ?? 0) + 1,
            (row[j] ?? 0) + (input[i] === choice[j] ? 0 : 1),
          ),
        );
      }
      row = next;
    }
    const distance = row[choice.length] ?? 0;
    if (distance > 0 && distance < bestDistance) {
      best = choice;
      bestDistance = distance;
    }
  }
  return best;
}

/** Add a spelling suggestion and a help command without dumping full usage. */
export function parseErrorHint(
  yargs: Argv,
  message: string,
  rootCommands: string[],
): string {
  const parser = yargs as ParserContext;
  const argv = parser.parsed ? parser.parsed.argv : undefined;
  const context = parser.getInternalMethods().getContext().commands;
  const hints: string[] = [];

  if (argv && /^Unknown (argument|command)s?:/.test(message)) {
    const unknown = message
      .slice(message.indexOf(":") + 1)
      .trim()
      .split(", ");
    const first = String(argv._[0] ?? "");
    if (context.length === 0 && unknown.includes(first)) {
      const suggestion = closestMatch(first, rootCommands);
      if (suggestion) hints.push(`Did you mean ${suggestion}?`);
    }
    const options = parser.getOptions();
    const optionNames = Object.keys(options.key);
    for (const name of unknown) {
      if (
        !(name in argv) ||
        optionNames.includes(name) ||
        name in options.alias
      )
        continue;
      const suggestion = closestMatch(name, optionNames);
      if (suggestion) hints.push(`Did you mean --${suggestion}?`);
    }
  }

  hints.push(`Run \`${["bunny", ...context, "--help"].join(" ")}\` for usage.`);
  return [...new Set(hints)].join(" ");
}
