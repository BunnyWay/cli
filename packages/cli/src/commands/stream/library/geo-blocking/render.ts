import { formatTable } from "@/core/format.ts";
import { logger } from "@/core/logger.ts";
import type { OutputFormat } from "@/core/types.ts";
import {
  COUNTRY_CODES,
  countryName,
  type GeoBlocking,
} from "@/tools/stream/index.ts";

const LIST_HINT =
  "Supported countries and codes: bunny stream libraries geo-blocking countries";

export const libraryPositional = {
  type: "string",
  describe: "Video library name or ID",
} as const;

/** Blocked countries; past half the list it reads better as the few still allowed. */
export function renderGeoBlocking(
  geo: GeoBlocking,
  output: OutputFormat,
): void {
  if (geo.blocked.length === 0) {
    logger.info("Geo-blocking is off: video is delivered to every country.");
    logger.dim(LIST_HINT);
    return;
  }
  const blocked = new Set(geo.blocked);
  const allowed = COUNTRY_CODES.filter((code) => !blocked.has(code));
  const allowMode = allowed.length < geo.blocked.length;
  const list = allowMode ? allowed : geo.blocked;
  logger.log(
    allowMode
      ? `Allowing only ${allowed.length} countr${allowed.length === 1 ? "y" : "ies"}; ${geo.blocked.length} are blocked:`
      : `Blocking ${geo.blocked.length} countr${geo.blocked.length === 1 ? "y" : "ies"}:`,
  );
  logger.log(
    formatTable(
      ["Code", "Country"],
      list.map((code) => [code, countryName(code)]),
      output,
    ),
  );
  logger.dim(LIST_HINT);
}
