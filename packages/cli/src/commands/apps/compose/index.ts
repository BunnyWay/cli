import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { UserError } from "../../../core/errors.ts";
import { ComposeFileSchema } from "./schema.ts";

export { findComposeFile } from "./find.ts";
export type { ComposeFile, ComposeService } from "./schema.ts";
export type { TranslateResult } from "./translate.ts";
export { composeToConfig } from "./translate.ts";

/**
 * Read and validate a compose file. Throws `UserError` with a clear
 * message on parse/validation failure.
 */
export function loadComposeFile(
  path: string,
): ReturnType<typeof ComposeFileSchema.parse> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new UserError(
      `Could not read compose file at ${path}.`,
      err instanceof Error ? err.message : String(err),
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new UserError(
      `Could not parse compose YAML at ${path}.`,
      err instanceof Error ? err.message : String(err),
    );
  }

  const result = ComposeFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new UserError(
      `Compose file at ${path} is not valid.`,
      result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("\n"),
    );
  }
  return result.data;
}
