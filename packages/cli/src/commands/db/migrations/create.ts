import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { defineCommand } from "../../../core/define-command.ts";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { isInteractive, prompts } from "../../../core/ui.ts";
import { ARG_DIR } from "./constants.ts";
import {
  discoverMigrations,
  nextSequence,
  resolveCreateMigrationsDir,
  slugify,
} from "./engine.ts";

const COMMAND = "create [name]";
const ALIASES = ["new"] as const;
const DESCRIPTION = "Create an empty migration file.";

interface CreateArgs {
  name?: string;
  [ARG_DIR]?: string;
}

/**
 * Create an empty, numbered migration file.
 *
 * The filename (`0001_add_users_table.sql`) is the migration's identity, so the
 * numeric prefix determines the order `db migrations apply` runs them in.
 *
 * @example
 * ```bash
 * bunny db migrations create add_users_table
 * bunny db migrations create "add users table" --dir db/migrations
 * ```
 */
export const dbMigrationsCreateCommand = defineCommand<CreateArgs>({
  command: COMMAND,
  aliases: ALIASES,
  describe: DESCRIPTION,
  examples: [
    [
      "$0 db migrations create add_users_table",
      "Create migrations/0001_add_users_table.sql",
    ],
    ["$0 db migrations create", "Prompt for a name"],
    [
      "$0 db migrations create add_index --dir db/migrations",
      "Use a custom directory",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        describe: "Migration name, used as the filename suffix",
      })
      .option(ARG_DIR, {
        type: "string",
        describe: "Migrations directory (default: migrations)",
      }),

  handler: async ({ name: nameArg, [ARG_DIR]: dirArg, output }) => {
    let name = nameArg;
    if (!name && isInteractive(output)) {
      const { value } = await prompts({
        type: "text",
        name: "value",
        message: "Migration name:",
        validate: (v: string) =>
          /[a-z0-9]/i.test(v) || "Must contain at least one letter or number",
      });
      name = value;
    }
    if (!name) throw new UserError("Migration name is required.");

    const dir = resolveCreateMigrationsDir(dirArg);

    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const slug = slugify(name);
    const sequence = nextSequence(discoverMigrations(dir));
    const filename = `${sequence}_${slug}.sql`;
    const path = join(dir, filename);

    if (existsSync(path)) {
      throw new UserError(
        `Migration already exists: ${relative(process.cwd(), path)}`,
      );
    }

    writeFileSync(path, `-- ${filename}\n`);

    const displayPath = relative(process.cwd(), path);

    if (output === "json") {
      logger.log(
        JSON.stringify({ name: filename, path: displayPath }, null, 2),
      );
      return;
    }

    logger.success(`Created ${displayPath}`);
    logger.dim("Add your SQL, then run `bunny db migrations apply`.");
  },
});
