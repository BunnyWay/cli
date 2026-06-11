import { createComputeClient } from "@bunny.net/openapi-client";
import { scriptToBinding } from "@bunny.net/project-config";
import prompts from "prompts";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { loadProjectConfig, upsertBinding } from "../../core/project-config.ts";
import { spinner } from "../../core/ui.ts";
import { fetchScript, fetchScripts } from "../scripts/api.ts";
import {
  ARG_BINDING,
  ARG_BINDING_DESCRIPTION,
  assertBindingName,
  ensureBindingReplaceable,
} from "./shared.ts";

const ARG_SCRIPT_ID = "script-id";
const ARG_ENTRY = "entry";

const COMMAND = `script <${ARG_BINDING}> [${ARG_SCRIPT_ID}]`;
const DESCRIPTION = "Map an existing Edge Script into the project config.";

interface AddScriptArgs {
  [ARG_BINDING]: string;
  [ARG_SCRIPT_ID]?: number;
  [ARG_ENTRY]?: string;
}

/** Fetch an Edge Script (by ID or interactive selection) and record it under the given binding. */
export const projectAddScriptCommand = defineCommand<AddScriptArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 project add script api", "Interactive selection"],
    ["$0 project add script api 1234", "Map a known script ID"],
    [
      "$0 project add script api 1234 --entry src/index.ts",
      "Record a local entry point for tooling",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional(ARG_BINDING, {
        type: "string",
        describe: ARG_BINDING_DESCRIPTION,
        demandOption: true,
      })
      .positional(ARG_SCRIPT_ID, {
        type: "number",
        describe: "Edge Script ID (prompts for selection when omitted)",
      })
      .option(ARG_ENTRY, {
        type: "string",
        describe: "Local entry point to record alongside the script",
      }),

  handler: async (args) => {
    const { profile, output, verbose, apiKey } = args;
    const binding = args[ARG_BINDING];
    const isInteractive = output !== "json" && process.stdout.isTTY;

    assertBindingName(binding);
    const projectConfig = loadProjectConfig();

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createComputeClient(clientOptions(config, verbose));

    let script: Parameters<typeof scriptToBinding>[0];
    const scriptIdArg = args[ARG_SCRIPT_ID];
    if (scriptIdArg != null) {
      const spin = spinner("Fetching script...");
      spin.start();
      script = await fetchScript(client, scriptIdArg);
      spin.stop();
    } else {
      const spin = spinner("Fetching scripts...");
      spin.start();
      const all = await fetchScripts(client);
      spin.stop();

      if (all.length === 0) {
        throw new UserError(
          "No Edge Scripts found.",
          'Run "bunny scripts create" to create one.',
        );
      }

      const { selected } = await prompts({
        type: "select",
        name: "selected",
        message: `Select a script to map as "${binding}":`,
        choices: all.map((s) => ({
          title: `${s.Name ?? s.Id} (${s.Id})`,
          value: s,
        })),
      });
      if (!selected) throw new UserError("Cancelled.");
      script = selected;
    }

    const entry = scriptToBinding(script);
    if (args[ARG_ENTRY]) entry.entry = args[ARG_ENTRY];

    await ensureBindingReplaceable(
      projectConfig,
      "scripts",
      binding,
      entry.id,
      isInteractive,
    );

    const path = upsertBinding("scripts", binding, entry);

    if (output === "json") {
      logger.log(JSON.stringify({ binding, ...entry, path }));
      return;
    }

    logger.success(
      `Mapped scripts.${binding} → ${entry.name ?? entry.id} (${entry.id}).`,
    );
  },
});
