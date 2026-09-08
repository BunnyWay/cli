import chalk from "chalk";
import type { CommandModule } from "yargs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { apiCommand } from "./commands/api.ts";
import { appsNamespace } from "./commands/apps/index.ts";
import { authNamespace } from "./commands/auth/index.ts";
import { authLoginCommand } from "./commands/auth/login.ts";
import { authLogoutCommand } from "./commands/auth/logout.ts";
import { configNamespace } from "./commands/config/index.ts";
import { dbNamespace } from "./commands/db/index.ts";
import { dnsNamespace } from "./commands/dns/index.ts";
import { docsCommand } from "./commands/docs.ts";
import { openCommand } from "./commands/open.ts";
import { registriesNamespace } from "./commands/registries/index.ts";
import { registryNamespace } from "./commands/registry/index.ts";
import { sandboxNamespace } from "./commands/sandbox/index.ts";
import { scriptsNamespace } from "./commands/scripts/index.ts";
import { sitesNamespace } from "./commands/sites/index.ts";
import { skillsNamespace } from "./commands/skills/index.ts";
import { storageNamespace } from "./commands/storage/index.ts";
import { whoamiCommand } from "./commands/whoami.ts";
import { bunny } from "./core/colors.ts";
import { groupHelpOptions, optionKeys } from "./core/define-command.ts";
import { logger } from "./core/logger.ts";
import { suggest } from "./core/suggest.ts";
import { VERSION } from "./core/version.ts";

const commands: CommandModule[] = [
  authLoginCommand,
  authLogoutCommand,
  whoamiCommand,
  dbNamespace,
  dnsNamespace,
  scriptsNamespace,
  sandboxNamespace,
  storageNamespace,
  configNamespace,
  skillsNamespace,
  docsCommand,
  openCommand,
  apiCommand,
];

// Experimental commands — registered but hidden from help and landing page
const experimentalCommands: CommandModule[] = [
  appsNamespace,
  registriesNamespace,
  registryNamespace,
  sitesNamespace,
  authNamespace,
];

const topLevelNames = [...commands, ...experimentalCommands].flatMap((cmd) => {
  const names = Array.isArray(cmd.command) ? cmd.command : [cmd.command ?? ""];
  return [...names.map((n) => n.split(" ")[0]), ...(cmd.aliases ?? [])];
});

// Runtime accessors that @types/yargs leaves out.
interface ParserInternals {
  parsed?: { argv: Record<string, unknown> & { _: unknown[] } };
  getInternalMethods(): { getContext(): { commands: string[] } };
}

// yargs skips its own top-level recommendation when a `$0` default command exists, so cover commands and flags here.
function didYouMean(msg: string, parser: ParserInternals): string | undefined {
  const argv = parser.parsed?.argv;
  const unknown =
    msg.match(/^Unknown arguments?: (.+)$/)?.[1]?.split(", ") ?? [];
  if (!argv || unknown.length === 0) return undefined;
  const commandDepth = parser.getInternalMethods().getContext().commands.length;
  for (const token of unknown) {
    if (commandDepth === 0 && token === String(argv._[0] ?? "")) {
      const match = suggest(token, topLevelNames);
      if (match) return `Did you mean ${match}?`;
    }
    if (token in argv && token !== "_") {
      const match = suggest(token, optionKeys(instance));
      if (match) return `Did you mean --${match}?`;
    }
  }
  return undefined;
}

let instance = yargs(hideBin(process.argv))
  .scriptName("bunny")
  .version(`${VERSION} ${process.platform}-${process.arch}`)
  .usage("$0 <command> [options]")

  .option("profile", {
    alias: "p",
    type: "string",
    default: "default",
    describe: "Configuration profile to use",
    global: true,
  })
  .option("verbose", {
    alias: "v",
    type: "boolean",
    default: false,
    describe: "Enable verbose output",
    global: true,
  })
  .option("output", {
    alias: "o",
    type: "string",
    choices: ["text", "json", "table", "csv", "markdown"] as const,
    default: "text",
    describe: "Output format",
    global: true,
  })
  .option("api-key", {
    type: "string",
    describe: "API key (takes priority over profile and environment)",
    global: true,
  });

for (const cmd of [...commands, ...experimentalCommands]) {
  instance = instance.command(cmd);
}

export const cli = instance
  .command(
    "$0",
    false as never,
    // Grouping here reaches root help only; done on the root instance it would print ahead of every subcommand's own flags.
    (y) => {
      groupHelpOptions(y);
      return y;
    },
    () => {
      const art = `
                  @@@@
                 @@@@
                 @@@@
               @@@@@@  @@@@@@@     @@@@      @@@@@  @@@@ @@@@@@@@    @@@@ @@@@@@@@  @@@@@      @@@@
            @@@@@@@@@@@@@@@@@@@@   @@@@      @@@@   @@@@@@@@@@@@@@   @@@@@@@@@@@@@@ @@@@@     @@@@@
                           @@@@@  @@@@@      @@@@   @@@@@    @@@@@   @@@@@    @@@@@  @@@@    @@@@@
    @@@@ @@@@@@@@@@@        @@@@@ @@@@       @@@@  @@@@@      @@@@  @@@@@      @@@@  @@@@@  @@@@@                        ${bunny("@@")}
               @@@@@        @@@@  @@@@      @@@@@  @@@@      @@@@@  @@@@       @@@@   @@@@ @@@@@      ${bunny("@@ @@@     @@@@  @@@@@@")}
               @@@@@       @@@@@  @@@@      @@@@   @@@@      @@@@@  @@@@      @@@@@   @@@@@@@@@      ${bunny("@@@@  @@  @@   @@  @@")}
               @@@@@      @@@@@  @@@@@     @@@@@   @@@@      @@@@   @@@@      @@@@    @@@@@@@@       ${bunny("@@    @@ @@@@@@@   @@")}
               @@@@@@@@@@@@@@@    @@@@@@@@@@@@@@  @@@@@      @@@@  @@@@@      @@@@     @@@@@@        ${bunny("@@    @@ @@        @@")}
              @@@@ @@@@@@@@@       @@@@@@@@  @@@  @@@@      @@@@@  @@@@      @@@@@     @@@@@     @@  ${bunny("@@    @@  @@@@@    +@@@")}
                                                                                      @@@@@
                                                                                     @@@@@
                                                                                    @@@@@
      `;
      if ((process.stdout.columns ?? 0) >= 135) {
        console.log(art);
      }
      logger.dim(`  ${chalk.bold("bunny")} ${chalk.gray(`v${VERSION}`)}`);
      logger.dim("  The official bunny.net CLI.\n");

      console.log(bunny.bold("  Commands:\n"));
      for (const cmd of commands) {
        const name = Array.isArray(cmd.command) ? cmd.command[0] : cmd.command;
        if (!name) continue;
        logger.dim(
          `    ${chalk.reset.bold(name.split(" ")[0].padEnd(12))}${cmd.describe}`,
        );
      }

      console.log();
      console.log(bunny.bold("  Global Options:\n"));
      logger.dim(
        `    ${chalk.reset.bold("-p, --profile".padEnd(22))}Configuration profile to use ${chalk.gray('(default: "default")')}`,
      );
      logger.dim(
        `    ${chalk.reset.bold("-o, --output".padEnd(22))}Output format: text, json, table, csv, markdown ${chalk.gray('(default: "text")')}`,
      );
      logger.dim(
        `    ${chalk.reset.bold("--api-key".padEnd(22))}API key (takes priority over profile and environment)`,
      );
      logger.dim(
        `    ${chalk.reset.bold("-v, --verbose".padEnd(22))}Enable verbose output`,
      );

      console.log();
      const examples = [
        ["Create a database", "bunny db create"],
        ["Create an edge script", "bunny scripts init"],
        ["Add a domain to manage DNS", "bunny dns zones add example.com"],
        ["Create a dev sandbox", "bunny sandbox create my-sandbox"],
        // ["Deploy a static site", "bunny sites deploy"],
        // ["Deploy an app", "bunny apps deploy"],
      ];

      console.log(bunny.bold("  Examples:\n"));
      for (const [desc, cmd] of examples) {
        logger.dim(`  ${chalk.gray("–")} ${desc}\n`);
        console.log(`    ${bunny(`$ ${cmd}`)}\n`);
      }

      console.log();
      logger.dim("  Run `bunny <command> --help` for more information.");
      logger.dim("  Run `bunny login` to get started.\n");
    },
  )
  .completion("completion", "Generate shell completion script")
  .recommendCommands()
  .strict()
  .fail((msg, err) => {
    const parser = instance as unknown as ParserInternals;
    const path = parser.getInternalMethods().getContext().commands;
    let message = err?.message || msg || "Invalid arguments.";
    let suggestion = err ? undefined : didYouMean(message, parser);
    if (!err && message.startsWith("Did you mean ")) {
      // yargs' own recommendation replaces the message, so restate what was rejected.
      suggestion = message;
      const unknown = parser.parsed?.argv._[path.length];
      message = unknown ? `Unknown command: ${unknown}` : "Unknown command.";
    }
    const usage = `Run \`${["bunny", ...path, "--help"].join(" ")}\` for usage.`;
    if (parser.parsed?.argv.output === "json") {
      const hint = [suggestion, usage].filter(Boolean).join(" ");
      // Wait for the write to flush: exiting first can truncate piped JSON.
      process.stdout.write(
        `${JSON.stringify({ error: message, hint })}\n`,
        () => process.exit(1),
      );
      return;
    }
    logger.error(message);
    if (suggestion) logger.dim(suggestion);
    logger.dim(usage);
    process.exit(1);
  })
  .help()
  .wrap(Math.min(120, process.stdout.columns ?? 80));
