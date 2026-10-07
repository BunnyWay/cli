import { UserError } from "@bunny.net/openapi-client";
import type { SourcePlugin } from "./contracts.ts";

/** Reject a folder filter for sources with no folder concept, instead of silently importing nothing. */
export function assertFolderSupported(
  plugin: SourcePlugin,
  folderId?: string,
): void {
  if (!folderId || plugin.supportsFolders) return;

  throw new UserError(
    `${plugin.label} has no folders, so --folder cannot be used.`,
    `Re-run without --folder to import everything from ${plugin.label}.`,
  );
}
