import type { components } from "@bunny.net/openapi-client/generated/compute.d.ts";

export type EdgeScriptTypes = components["schemas"]["EdgeScriptTypes"];

/** Scriptable DNS scripts are EdgeScriptType 0 on the compute API. */
export const SCRIPT_TYPE_DNS: EdgeScriptTypes = 0;

/** Local manifest written by `bunny dns scripts` commands. */
export const DNS_SCRIPT_MANIFEST = "dns-script.json";

/** Default entry file for a scaffolded DNS script. */
export const DEFAULT_ENTRY = "handleQuery.js";

/** Package providing ambient types for the Scriptable DNS runtime. */
export const TYPES_PACKAGE = "@bunny.net/scriptable-dns-types";
export const TYPES_PACKAGE_VERSION = "^0.1.0";

export interface DnsScriptManifest {
  id?: number;
  name?: string;
  scriptType?: EdgeScriptTypes;
  entry?: string;
}

export interface DnsScriptExample {
  key: string;
  title: string;
  code: string;
}

const REFERENCE = `/// <reference types="${TYPES_PACKAGE}" />`;

/** Starter examples offered by `bunny dns scripts init`, keyed by intent. */
export const EXAMPLES: DnsScriptExample[] = [
  {
    key: "empty",
    title: "Empty: return a single A record",
    code: `${REFERENCE}

/** @param {DnsRequest} query */
export default function handleQuery(query) {
  return new ARecord("203.0.113.10", 30);
}
`,
  },
  {
    key: "geo",
    title: "Geo routing: answer by client country",
    code: `${REFERENCE}

/** @param {DnsRequest} query */
export default function handleQuery(query) {
  if (query.request.geoLocation.country === "DE") {
    return new ARecord("203.0.113.20", 30);
  }
  return new ARecord("203.0.113.10", 30);
}
`,
  },
  {
    key: "closest",
    title: "Closest server: route to the nearest location",
    code: `${REFERENCE}

/** @param {DnsRequest} query */
export default function handleQuery(query) {
  const servers = [
    new Server("203.0.113.10", 40.69, -74.18),
    new Server("203.0.113.11", 52.31, 4.76),
    new Server("203.0.113.12", -37.67, 144.85),
  ];
  return RoutingEngine.getClosestServer(servers, query.request.geoLocation, true);
}
`,
  },
  {
    key: "weighted",
    title: "Weighted round robin: spread load by weight",
    code: `${REFERENCE}

/** @param {DnsRequest} query */
export default function handleQuery(query) {
  const servers = [
    new Server("203.0.113.10", 40.69, -74.18, 100),
    new Server("203.0.113.11", 52.31, 4.76, 50),
  ];
  return RoutingEngine.getWeightedRandom(servers, true);
}
`,
  },
  {
    key: "failover",
    title: "Failover: answer with a healthy IP",
    code: `${REFERENCE}

/** @param {DnsRequest} query */
export default function handleQuery(query) {
  if (Monitoring.getStatus("203.0.113.10").isOnline) {
    return new ARecord("203.0.113.10", 30);
  }
  return new ARecord("203.0.113.11", 30);
}
`,
  },
  {
    key: "pullzone",
    title: "Pull zone: map the answer to a pull zone",
    code: `${REFERENCE}

/** @param {DnsRequest} query */
export default function handleQuery(query) {
  return new PullZoneRecord("my-pull-zone");
}
`,
  },
];

/** tsconfig that typechecks a DNS script against the ambient runtime types. */
export const TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "bundler",
      allowJs: true,
      checkJs: true,
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      types: [TYPES_PACKAGE],
    },
    include: ["*.js"],
  },
  null,
  2,
)}
`;
