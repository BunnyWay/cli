import { updateLinkedConfig } from "../linked-config.ts";

export function removeVolumeFromConfig(appId: string, name: string): void {
  updateLinkedConfig(appId, (config) => {
    let changed = false;

    for (const container of Object.values(config.app.containers)) {
      const volumes = container.volumes?.filter((v) => v.name !== name);
      if (volumes?.length === container.volumes?.length) continue;

      changed = true;
      if (volumes?.length) container.volumes = volumes;
      else delete container.volumes;
    }

    return changed;
  });
}
