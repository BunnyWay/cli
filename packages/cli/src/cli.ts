import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { appsNamespace } from "./commands/apps/index.ts";
import { authLoginCommand } from "./commands/auth/login.ts";
import { authLogoutCommand } from "./commands/auth/logout.ts";
import { configNamespace } from "./commands/config/index.ts";
import { dbNamespace } from "./commands/db/index.ts";
import { scriptsNamespace } from "./commands/scripts/index.ts";
import { docsCommand } from "./commands/docs.ts";
import { whoamiCommand } from "./commands/whoami.ts";
import { logger } from "./core/logger.ts";
import { VERSION } from "./core/version.ts";

export const cli = yargs(hideBin(process.argv))
  .scriptName("bunny")
  .version(VERSION)
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
  })

  .command(appsNamespace)
  .command(authLoginCommand)
  .command(authLogoutCommand)
  .command(configNamespace)
  .command(dbNamespace)
  .command(docsCommand)
  .command(scriptsNamespace)
  .command(whoamiCommand)

  .demandCommand(1, "Run `bunny --help` to see available commands.")
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
