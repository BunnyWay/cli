import type { Argv, CommandModule } from "yargs";
import { logger } from "./logger.ts";

export function withPreviewNotice(
  namespace: CommandModule,
  product: string,
): CommandModule {
  return {
    ...namespace,
    builder: (yargs: Argv) =>
      (namespace.builder as (y: Argv) => Argv)(yargs).middleware((argv) => {
        if (argv.output === "json") return;
        logger.info(
          `${product} is in Public Preview: commands may change. Report feedback and bugs at https://github.com/BunnyWay/cli/issues`,
        );
      }),
  };
}
