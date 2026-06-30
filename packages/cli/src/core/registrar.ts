interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, unknown[]];
}
interface RdapDomain {
  entities?: RdapEntity[];
}

/** Drop a trailing legal suffix so "Namecheap, Inc." reads as "Namecheap". */
function tidyName(name: string): string | null {
  const cleaned = name
    .trim()
    .replace(/,?\s+(inc|llc|l\.l\.c|ltd|limited|corp|co)\.?$/i, "")
    .trim();
  return cleaned || null;
}

/** Pull the registrar's display name out of an RDAP domain response. */
export function parseRegistrar(data: unknown): string | null {
  const { entities = [] } = (data ?? {}) as RdapDomain;
  const registrar = entities.find((e) => (e.roles ?? []).includes("registrar"));
  for (const entry of registrar?.vcardArray?.[1] ?? []) {
    if (
      Array.isArray(entry) &&
      entry[0] === "fn" &&
      typeof entry[3] === "string"
    )
      return tidyName(entry[3]);
  }
  return null;
}

/** Best-effort registrar lookup via RDAP; null when it can't be determined. */
export async function detectRegistrar(domain: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://rdap.org/domain/${encodeURIComponent(domain)}`,
      {
        headers: { Accept: "application/rdap+json" },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!res.ok) return null;
    return parseRegistrar(await res.json());
  } catch {
    return null;
  }
}
