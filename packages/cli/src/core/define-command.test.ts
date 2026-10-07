import { expect, test } from "bun:test";
import yargs from "yargs";
import { groupHelpOptions } from "./define-command.ts";

// `--lib` with alias `--library` is two keys to yargs; help must still list it once.
test("groupHelpOptions lists an option with an alias once", async () => {
  const y = yargs([])
    .scriptName("bunny")
    .option("lib", { alias: "library", type: "string", describe: "Library" })
    .option("force", { alias: "f", type: "boolean", describe: "Force" });
  groupHelpOptions(y, "show [video]");
  const help = await y.getHelp();
  expect(help.match(/--lib, --library/g)?.length).toBe(1);
  expect(help.match(/-f, --force/g)?.length).toBe(1);
});
