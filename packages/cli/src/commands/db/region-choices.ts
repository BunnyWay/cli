import type { components } from "@bunny.net/api/generated/database.d.ts";

type PossibleRegion = components["schemas"]["PossibleRegion"];
type Region = components["schemas"]["Region"];

export const GROUP_LABELS: Record<string, string> = {
  EU: "Europe",
  NA: "North America",
  SA: "South America",
  AF: "Africa",
  ASIA: "Asia",
  OC: "Oceania",
};

export const GROUP_ORDER = ["EU", "NA", "SA", "AF", "ASIA", "OC"];

/** Build prompt choices grouped by continent. */
export function groupedRegionChoices(
  regions: Region[],
  selected?: Set<string>,
) {
  const byGroup = new Map<string, Region[]>();
  for (const r of regions) {
    const group = r.group ?? "Other";
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)?.push(r);
  }

  const choices: {
    title: string;
    value: PossibleRegion | null;
    disabled?: boolean;
    selected?: boolean;
  }[] = [];

  for (const group of GROUP_ORDER) {
    const groupRegions = byGroup.get(group);
    if (!groupRegions || groupRegions.length === 0) continue;
    choices.push({
      title: `── ${GROUP_LABELS[group] ?? group} ──`,
      value: null as unknown as PossibleRegion,
      disabled: true,
    });
    for (const r of groupRegions) {
      choices.push({
        title: `${r.name} (${r.id})`,
        value: r.id,
        selected: selected?.has(r.id),
      });
    }
  }

  return choices;
}
