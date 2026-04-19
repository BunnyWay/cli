import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { openBrowser } from "../../core/ui.ts";
import { DOCS_BASE_URL } from "../docs.ts";

const COMMAND = "docs";
const DESCRIPTION = "Open database documentation in the browser.";
const URL = `${DOCS_BASE_URL}/database`;

/**
 * Open the database documentation in the default browser.
 *
 * @example
 * ```bash
 * bunny db docs
 * ```
 */
export const dbDocsCommand = defineCommand({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [["$0 db docs", "Open database documentation"]],

  handler: async () => {
    logger.info(`Opening ${URL}`);
    openBrowser(URL);
  },
});
