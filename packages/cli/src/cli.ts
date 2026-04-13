import chalk from "chalk";
import type { CommandModule } from "yargs";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { appsNamespace } from "./commands/apps/index.ts";
import { authLoginCommand } from "./commands/auth/login.ts";
import { authLogoutCommand } from "./commands/auth/logout.ts";
import { configNamespace } from "./commands/config/index.ts";
import { dbNamespace } from "./commands/db/index.ts";
import { registriesNamespace } from "./commands/registries/index.ts";
import { scriptsNamespace } from "./commands/scripts/index.ts";
import { docsCommand } from "./commands/docs.ts";
import { whoamiCommand } from "./commands/whoami.ts";
import { logger } from "./core/logger.ts";
import { getLatestVersion } from "./core/update-check.ts";
import { VERSION } from "./core/version.ts";

const commands: CommandModule[] = [
  authLoginCommand,
  authLogoutCommand,
  whoamiCommand,
  dbNamespace,
  scriptsNamespace,
  registriesNamespace,
  configNamespace,
  docsCommand,
];

// Experimental commands — registered but hidden from help and landing page
const experimentalCommands: CommandModule[] = [appsNamespace];

let instance = yargs(hideBin(process.argv))
  .scriptName("bunny")
  .version(false)
  .option("version", {
    type: "boolean",
    describe: "Show version number",
    global: false,
  })
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
    () => {},
    async (argv) => {
      if (argv.version) {
        console.log(`${VERSION} ${process.platform}-${process.arch}`);
        const latest = await getLatestVersion();
        if (latest && latest !== VERSION) {
          console.log(
            `\nUpdate available: ${VERSION} → ${latest}` +
              `\nRun: curl -fsSL https://github.com/BunnyWay/cli/raw/main/install.sh | sh`,
          );
        }
        return;
      }

      const bunny = chalk.hex("#FF6600");
      // const art = `
// ${bunny("             =@@@.")}
// ${bunny("            .#@@*..--:..   .....   ............:-:..  ......:--.. .....    .....")}
// ${bunny("         -@@@@@@@@@@@@@@=. .@@@.   .#@@*.+@@@@@@@@@%. :@@@@@@@@@@=.@@@=   .%@@*.")}
// ${bunny("    ..  ............-#@@@=.+@@%.   .%@@=.#@@@*::*@@@+.-@@@%+:=%@@%.*@@@. .#@@*.")}
// ${bunny('   =@@..@@@@@@@#.    .#@@#.%@@*    :@@@:.@@@.   .%@@+.+@@@.   =@@%.-@@@-.#@@#.')}
// ${bunny('    ..     .#@@+.    .%@@+:@@@=    +@@#.=@@%.   :@@@-.#@@+.  .*@@#..%@@*#@@*.')}
// ${bunny("           :@@@%.   :%@@%.:@@@=  .:@@@+.#@@*    =@@@..@@@.   .%@@+. -@@@@@#.")}
// ${bunny("           -@@@@@@@@@@@+. .%@@@@@@@@@@-.%@@=   .#@@*.=@@%.   :@@@:  .%@@@*.")}
// ${bunny("           -++-:*@@%+:.    .=@@@%=-%%#.:*##:   .*##:.*%%+    -##*.  .#@@*.")}
// ${bunny("                                                                   .%@@*.")}
// ${bunny("                                                                  .%@@*.")}
// `;
      // console.log(art);
      console.log();
      logger.dim(`  ${chalk.bold("bunny")} ${chalk.dim(`v${VERSION}`)}`);
      logger.dim("  The official bunny.net CLI.\n");

      console.log(bunny.bold("  Commands:\n"));
      for (const cmd of commands) {
        const name = Array.isArray(cmd.command)
          ? cmd.command[0]
          : cmd.command;
        if (!name) continue;
        logger.dim(`    ${chalk.reset.bold(name.split(" ")[0].padEnd(12))}${cmd.describe}`);
      }

      console.log();
      console.log(bunny.bold("  Global Options:\n"));
      logger.dim(`    ${chalk.reset.bold("-p, --profile".padEnd(22))}Configuration profile to use ${chalk.dim("(default: \"default\")")}`);
      logger.dim(`    ${chalk.reset.bold("-o, --output".padEnd(22))}Output format: text, json, table, csv, markdown ${chalk.dim("(default: \"text\")")}`);
      logger.dim(`    ${chalk.reset.bold("--api-key".padEnd(22))}API key (takes priority over profile and environment)`);
      logger.dim(`    ${chalk.reset.bold("-v, --verbose".padEnd(22))}Enable verbose output`);

      console.log();
      const examples = [
        ["Create a database", "bunny db create"],
        ["Create an edge script", "bunny scripts init"],
        // ["Deploy an app", "bunny apps deploy"],
      ];

      console.log(bunny.bold("  Examples:\n"));
      for (const [desc, cmd] of examples) {
        logger.dim(`  ${chalk.dim("–")} ${desc}\n`);
        console.log(`    ${bunny("$ " + cmd)}\n`);
      }

      console.log();
      logger.dim("  Run `bunny <command> --help` for more information.");
      logger.dim("  Run `bunny login` to get started.\n");
    },
  )
  .completion("completion", "Generate shell completion script")
  .recommendCommands()
  .strict()
  .fail((msg, err, yargs) => {
    if (err) {
      logger.error(err.message);
    } else if (msg) {
      logger.error(msg);
      console.log();
      yargs.showHelp();
    }
    process.exit(1);
  })
  .help()
  .wrap(Math.min(120, process.stdout.columns ?? 80));
