import { log, S_BAR, S_ERROR, S_INFO, S_SUCCESS, S_WARN } from "@clack/prompts";
import chalk from "chalk";
import { bunny } from "./colors.ts";

// Messages continue the prompt gutter on stderr; `spacing: 0` hangs a line off the message above it instead of opening a new block.
const output = process.stderr;
const bar = chalk.gray(S_BAR);

function message(text: string, symbol: string, spacing = 1): void {
  log.message(text, { output, symbol, spacing });
}

export const logger = {
  /** Command output on stdout: tables, values, JSON. Never decorated. */
  log: (msg = "") => process.stdout.write(`${msg}\n`, () => {}),
  info: (msg: string) => message(msg, bunny(S_INFO)),
  success: (msg: string, symbolColor: (text: string) => string = chalk.green) =>
    message(msg, symbolColor(S_SUCCESS)),
  warn: (msg: string) => message(msg, chalk.yellow(S_WARN)),
  error: (msg: string) => message(msg, chalk.red(S_ERROR)),
  dim: (msg: string) => message(chalk.gray(msg), bar, 0),
  accent: (msg: string) => message(bunny(msg), bar, 0),
  debug: (msg: string, verbose: boolean) => {
    if (verbose) message(chalk.gray(`[debug] ${msg}`), bar, 0);
  },
};
