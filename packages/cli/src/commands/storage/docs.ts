import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { openBrowser } from "../../core/ui.ts";
import { DOCS_BASE_URL } from "../docs.ts";

const COMMAND = "docs";
const DESCRIPTION = "Open storage documentation in the browser.";
const URL = `${DOCS_BASE_URL}/storage`;

export const storageDocsCommand = defineCommand({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [["$0 storage docs", "Open storage documentation"]],

  handler: async () => {
    logger.info(`Opening ${URL}`);
    openBrowser(URL);
  },
});
