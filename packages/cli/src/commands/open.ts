import { defineCommand } from "../core/define-command.ts";
import { logger } from "../core/logger.ts";
import { openBrowser } from "../core/ui.ts";

const DASHBOARD_URL =
  process.env.BUNNYNET_DASHBOARD_URL ?? "https://dash.bunny.net";

const COMMAND = "open";
const DESCRIPTION = "Open the bunny.net dashboard in the browser.";

/**
 * Open the bunny.net dashboard in the default browser.
 *
 * @example
 * ```bash
 * bunny open
 * bunny open --print
 * ```
 */
export const openCommand = defineCommand<{ print: boolean }>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 open", "Open the bunny.net dashboard"],
    ["$0 open --print", "Print the dashboard URL instead of opening it"],
  ],

  builder: (yargs) =>
    yargs.option("print", {
      type: "boolean",
      default: false,
      describe: "Print the URL instead of opening it in the browser",
    }),

  handler: async ({ print, output }) => {
    if (print) {
      if (output === "json") {
        console.log(JSON.stringify({ url: DASHBOARD_URL }));
      } else {
        console.log(DASHBOARD_URL);
      }
      return;
    }

    logger.info(`Opening ${DASHBOARD_URL}`);
    openBrowser(DASHBOARD_URL);
  },
});
