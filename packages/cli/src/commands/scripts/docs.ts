import { defineCommand } from "../../core/define-command.ts";
import { openBrowser } from "../../core/ui.ts";
import { logger } from "../../core/logger.ts";
import { DOCS_BASE_URL } from "../docs.ts";

const COMMAND = "docs";
const DESCRIPTION = "Open Edge Scripts documentation in the browser.";
const URL = `${DOCS_BASE_URL}/scripting`;

/**
 * Open the Edge Scripts documentation in the default browser.
 *
 * @example
 * ```bash
 * bunny scripts docs
 * ```
 */
export const scriptsDocsCommand = defineCommand({
  command: COMMAND,
  describe: DESCRIPTION,

  handler: async () => {
    logger.info(`Opening ${URL}`);
    openBrowser(URL);
  },
});
