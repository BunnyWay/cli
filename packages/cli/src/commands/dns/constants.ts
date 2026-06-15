/** Local manifest written by `bunny dns zones link`, read when a [domain] is omitted. */
export const DNS_MANIFEST = "dns.json";

export interface DnsManifest {
  id: number;
  domain?: string;
}
