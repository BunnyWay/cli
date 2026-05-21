import chalk from "chalk";

export const logger = {
  log: (msg = "") => console.log(msg),
  info: (msg: string) => console.error(chalk.blue("ℹ"), msg),
  success: (msg: string) => console.error(chalk.green("✓"), msg),
  warn: (msg: string) => console.error(chalk.yellow("⚠"), msg),
  error: (msg: string) => console.error(chalk.red("✖"), msg),
  dim: (msg: string) => console.error(chalk.dim(msg)),
  debug: (msg: string, verbose: boolean) => {
    if (verbose) console.error(chalk.gray("[debug]"), msg);
  },
};
