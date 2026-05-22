import chalk from "chalk";
import { bunny } from "./colors.ts";

export const logger = {
  log: (msg = "") => console.log(msg),
  info: (msg: string) => console.error(bunny("ℹ"), msg),
  success: (msg: string) => console.error(chalk.green("✓"), msg),
  warn: (msg: string) => console.error(chalk.yellow("⚠"), msg),
  error: (msg: string) => console.error(chalk.red("✖"), msg),
  dim: (msg: string) => console.error(chalk.gray(msg)),
  debug: (msg: string, verbose: boolean) => {
    if (verbose) console.error(chalk.gray("[debug]"), msg);
  },
};
