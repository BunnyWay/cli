import { formatKeyValue } from "@/core/format.ts";
import type { OutputFormat } from "@/core/types.ts";
import type { Watermark } from "@/tools/stream/index.ts";

export const APPLIES_TO_NEW =
  "The watermark is burned in while encoding, so it applies to videos uploaded from now on; existing videos keep what they were encoded with.";

const pct = (value: number | null) => (value === null ? "-" : `${value}%`);

export function formatWatermark(
  watermark: Watermark,
  output: OutputFormat,
): string {
  return formatKeyValue(
    [
      { key: "Watermark", value: watermark.enabled ? "Set" : "None" },
      { key: "Left", value: pct(watermark.left) },
      { key: "Top", value: pct(watermark.top) },
      { key: "Width", value: pct(watermark.width) },
      { key: "Height", value: pct(watermark.height) },
    ],
    output,
  );
}

export const libraryPositional = {
  type: "string",
  describe: "Video library name or ID",
} as const;
