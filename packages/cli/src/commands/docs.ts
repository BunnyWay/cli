import { defineCommand } from "../core/define-command.ts";
import { openBrowser } from "../core/ui.ts";
import { logger } from "../core/logger.ts";

export const DOCS_BASE_URL = "https://docs.bunny.net";

const COMMAND = "docs";
const DESCRIPTION = "Open bunny.net documentation in the browser.";

/**
 * Open bunny.net documentation in the default browser.
 *
 * @example
 * ```bash
 * bunny docs
 * ```
 */
export const docsCommand = defineCommand({
  command: COMMAND,
  describe: DESCRIPTION,

  handler: async () => {
    logger.info(`Opening ${DOCS_BASE_URL}`);
    openBrowser(DOCS_BASE_URL);
  },
});
