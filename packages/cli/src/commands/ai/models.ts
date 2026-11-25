import { defineCommand } from "@/core/define-command.ts";
import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import { aiFetch } from "./api.ts";

const COMMAND = "models";
const DESCRIPTION = "List the models your key can use.";

interface ModelList {
  data?: { id: string }[];
}

/**
 * List the models available to the configured key.
 *
 * @example
 * ```bash
 * bunny ai models
 * bunny ai models --output json
 * ```
 */
export const aiModelsCommand = defineCommand({
  command: COMMAND,
  aliases: ["ls"],
  describe: DESCRIPTION,
  examples: [["$0 ai models", "List available models"]],

  handler: async ({ output, verbose }) => {
    const res = await aiFetch("/v1/models", verbose);
    const models = ((await res.json()) as ModelList).data ?? [];

    if (output === "json") {
      logger.log(
        JSON.stringify(
          models.map((m) => m.id),
          null,
          2,
        ),
      );
      return;
    }

    if (models.length === 0) {
      logger.info("No models are available to this key.");
      return;
    }

    logger.log(
      formatTable(
        ["Model", "Publisher"],
        models.map((m) => {
          const slash = m.id.indexOf("/");
          return [m.id, slash === -1 ? "-" : m.id.slice(0, slash)];
        }),
        output,
      ),
    );
  },
});
