import type { components } from "@bunny.net/openapi-client/magic-containers";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { confirm } from "@/core/ui.ts";
import type { AppManifest } from "./constants.ts";

type Application = components["schemas"]["Application"];
type PatchApplicationRequest = components["schemas"]["PatchApplicationRequest"];

export function findRemovals(
  request: PatchApplicationRequest,
  app: Application,
): string[] {
  const keptContainers = new Set(
    (request.containerTemplates ?? []).map((ct) => ct.id),
  );
  const keptVolumes = new Set((request.volumes ?? []).map((v) => v.name));

  return [
    ...app.containerTemplates
      .filter((ct) => !keptContainers.has(ct.id))
      .map((ct) => `container "${ct.name}"`),
    ...app.volumes
      .filter((v) => !keptVolumes.has(v.name))
      .map((v) => `volume "${v.name}" and its data`),
  ];
}

export async function confirmRemovals(
  request: PatchApplicationRequest,
  app: Application,
  force?: boolean,
  output?: string,
): Promise<boolean> {
  const removals = findRemovals(request, app);
  if (removals.length === 0 || force) return true;

  if (output === "json") {
    throw new UserError(
      `This would permanently remove ${removals.join(", ")}.`,
      "Pass --force to confirm.",
    );
  }

  logger.warn("This will permanently remove:");
  for (const removal of removals) logger.log(`  - ${removal}`);

  return confirm("Continue?", { force });
}

export function pruneManifestContainers(
  containers: AppManifest["containers"] | undefined,
  names: string[],
): AppManifest["containers"] {
  const keep = new Set(names);

  return Object.fromEntries(
    Object.entries(containers ?? {}).filter(([name]) => keep.has(name)),
  );
}
