import { expect, test } from "bun:test";
import yargs from "yargs";
import { defineCommand } from "./define-command.ts";

function parser(
  onRun: (args: {
    id?: number;
    port?: number[];
    offset?: number;
    name?: string;
  }) => void,
) {
  return yargs()
    .exitProcess(false)
    .showHelpOnFail(false)
    .fail((message, error) => {
      throw error ?? new Error(message);
    })
    .command(
      defineCommand({
        command: "show [id]",
        describe: "Numeric validation fixture",
        builder: (y) =>
          y
            .positional("id", { type: "number" })
            .option("port", { type: "number", array: true, alias: "p" })
            .option("offset", { type: "number" })
            .option("name", { type: "string" }),
        handler: async (args) => onRun(args),
      }),
    );
}

test("finite numbers, zero, negatives, decimals and numeric-looking strings retain their values", async () => {
  const runs: unknown[] = [];
  await parser((args) => runs.push(args)).parseAsync([
    "show",
    "0",
    "-p",
    "80",
    "443",
    "--offset",
    "-0.5",
    "--name",
    "NaN",
  ]);
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({
    id: 0,
    port: [80, 443],
    offset: -0.5,
    name: "NaN",
  });
});

test("a bad number in an array alias blocks the handler", async () => {
  let ran = false;
  await expect(
    Promise.resolve().then(() =>
      parser(() => {
        ran = true;
      }).parseAsync(["show", "-p", "80", "abc"]),
    ),
  ).rejects.toThrow("Invalid value for -p: expected a finite number");
  expect(ran).toBe(false);
});

test("omitted numeric options and positionals remain optional", async () => {
  let ran = false;
  await parser(() => {
    ran = true;
  }).parseAsync(["show"]);
  expect(ran).toBe(true);
});
