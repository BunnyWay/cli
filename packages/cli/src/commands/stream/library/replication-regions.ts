import { regionName } from "@/commands/stream/regions.ts";
import { UserError } from "@/core/errors.ts";
import { confirmOrCancel, isInteractive, prompts } from "@/core/ui.ts";
import {
  MAIN_REGION,
  parseReplicationRegions,
  REGION_CODES,
  SUGGESTED_REPLICATION_REGIONS,
} from "@/tools/stream/index.ts";

/** Replication regions from the flag, else asked for when interactive, else none. */
export async function resolveReplicationRegions(
  flag: string[] | undefined,
  output: string | undefined,
): Promise<string[]> {
  if (flag !== undefined) return parseReplicationRegions(flag);
  if (!isInteractive(output)) return [];

  const answer = await confirmOrCancel(
    "Replicate this library to other regions? Replicas can't be removed once added.",
  );
  if (answer === "cancel") throw new UserError("Creation cancelled.");
  if (answer === "no") return [];

  const { picked } = await prompts({
    type: "multiselect",
    name: "picked",
    message: "Replication regions (each adds storage cost; space to toggle):",
    choices: REGION_CODES.filter((code) => code !== MAIN_REGION).map(
      (code) => ({
        title: `${regionName(code)} (${code})`,
        value: code,
        selected: SUGGESTED_REPLICATION_REGIONS.includes(code),
      }),
    ),
  });

  if (picked === undefined) throw new UserError("Creation cancelled.");
  return picked;
}
