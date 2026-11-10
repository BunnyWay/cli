import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";

// Kept hidden so old scripts get a clear explanation instead of an unknown-command suggestion to run `pull`.
export const appsPushCommand = defineCommand({
  command: "push",
  describe: "Removed: settings now have their own commands.",
  hidden: true,

  builder: (yargs) =>
    yargs
      .option("force", { alias: "f", type: "boolean" })
      .option("dry-run", { type: "boolean" })
      .option("allow-split-volumes", { type: "boolean" })
      .option("id", { type: "string" }),

  handler: async () => {
    throw new UserError(
      "`bunny apps push` was removed. bunny.jsonc settings are no longer applied to a running app, so nothing was changed.",
      "Use `bunny apps scale`, `bunny apps regions set`, `bunny apps endpoints`, `bunny apps volumes` or `bunny apps env` to change a setting, and `bunny apps deploy` to update images.",
    );
  },
});
