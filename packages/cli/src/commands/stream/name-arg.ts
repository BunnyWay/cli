import { UserError } from "@/core/errors.ts";

/** A name from the positional or `--name`; both given with different values is an error, not a silent pick. */
export function nameArg(
  positional: string | undefined,
  flag: string | undefined,
): string | undefined {
  const fromPositional = positional?.trim();
  const fromFlag = flag?.trim();

  if (fromPositional && fromFlag && fromPositional !== fromFlag) {
    throw new UserError(
      `Conflicting names: "${fromPositional}" and --name "${fromFlag}".`,
      "Pass the name once, either as the argument or as --name.",
    );
  }
  return fromFlag || fromPositional || undefined;
}
