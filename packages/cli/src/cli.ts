import chalk from "chalk";
import type { CommandModule } from "yargs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { apiCommand } from "./commands/api.ts";
import { appsNamespace } from "./commands/apps/index.ts";
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
import { GLOBAL_OPTION_KEYS, knownOptionKeys } from "./core/define-command.ts";
import { defineNamespace } from "./core/define-namespace.ts";
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
  // Hidden mount for the muscle-memory form `bunny auth login`.
  defineNamespace("auth", false, [authLoginCommand, authLogoutCommand]),
];

const topLevelNames = [...commands, ...experimentalCommands].flatMap((cmd) => {
  const names = Array.isArray(cmd.command) ? cmd.command : [cmd.command ?? ""];
  return [...names.map((n) => n.split(" ")[0]), ...(cmd.aliases ?? [])];
});

const rawArgs = hideBin(process.argv);
// Leading command words: global flags are stepped over, and collection stops at the first unknown flag since its arity is unknown.
function leadingPositionals(args: string[]): string[] {
  const valueFlags = ["-p", "--profile", "-o", "--output", "--api-key"];
  const boolFlags = ["-v", "--verbose", "--help", "--version", "-V"];
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("-")) {
      out.push(arg);
    } else if (valueFlags.includes(arg)) {
      i++;
    } else if (!boolFlags.includes(arg) && !arg.includes("=")) {
      break;
    }
  }
  return out;
}

const positionals = leadingPositionals(rawArgs);

// yargs skips its own top-level recommendation when a `$0` default command exists, so cover commands and flags here.
function didYouMean(msg: string): string | undefined {
  const unknown =
    msg.match(/^Unknown arguments?: (.+)$/)?.[1]?.split(", ") ?? [];
  for (const token of unknown) {
    if (
      rawArgs.some((a) => a === `--${token}` || a.startsWith(`--${token}=`))
    ) {
      const flags = [...knownOptionKeys, ...GLOBAL_OPTION_KEYS].filter(
        (k) => k.length > 1 && !/[A-Z]/.test(k),
      );
      const match = suggest(token, flags);
      return match && `Did you mean --${match}?`;
    }
    if (token === positionals[0]) {
      const match = suggest(token, topLevelNames);
      return match && `Did you mean ${match}?`;
    }
  }
  return undefined;
}

// Command path for the help pointer: the positionals typed, minus whatever yargs rejected.
function helpPath(msg: string): string {
  const unknown =
    msg.match(/^Unknown arguments?: (.+)$/)?.[1]?.split(", ") ?? [];
  let path = positionals.filter((p) => !unknown.includes(p));
  if (msg.startsWith("Did you mean")) path = path.slice(0, -1);
  return ["bunny", ...path, "--help"].join(" ");
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

// Grouping at the root is inherited by every subcommand and would print ahead of their own flags, so only do it for root help.
if (positionals.length === 0) {
  instance = instance.group(GLOBAL_OPTION_KEYS, "Global Options:");
}

export const cli = instance
  .command(
    "$0",
    false as never,
    () => {},
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
    if (err) {
      logger.error(err.message);
      process.exit(1);
    }
    logger.error(msg);
    const hint = didYouMean(msg);
    if (hint) logger.dim(hint);
    logger.dim(`Run \`${helpPath(msg)}\` for usage.`);
    process.exit(1);
  })
  .help()
  .wrap(Math.min(120, process.stdout.columns ?? 80));
