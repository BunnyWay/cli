import type { PlayerSettings } from "@bunny.net/tools/stream";
import { formatKeyValue } from "@/core/format.ts";
import type { OutputFormat } from "@/core/types.ts";

function onOff(value: boolean): string {
  return value ? "On" : "Off";
}

export function formatPlayerSettings(
  player: PlayerSettings,
  output: OutputFormat,
): string {
  return formatKeyValue(
    [
      { key: "Library ID", value: String(player.library) },
      { key: "UI language", value: player.language ?? "" },
      { key: "Font family", value: player.font ?? "" },
      { key: "Primary colour", value: player.color ?? "" },
      { key: "Caption colour", value: player.captionColor ?? "" },
      { key: "Caption background", value: player.captionBackground ?? "" },
      { key: "Caption size", value: String(player.captionSize ?? "") },
      {
        key: "Controls",
        value: player.controlsEnabled
          ? player.controls.join(", ") || "default"
          : "Off",
      },
      { key: "Playback speeds", value: player.speeds.join(", ") },
      { key: "Watch-time heatmap", value: onOff(player.heatmap) },
      { key: "Resumable position", value: onOff(player.rememberPosition) },
      { key: "Compact controls", value: onOff(player.compactControls) },
      {
        key: "Player",
        value: player.legacyPlayer
          ? "Legacy (1)"
          : `Current (${player.playerVersion ?? 2})`,
      },
      { key: "Captions in playlist", value: onOff(player.captionsInPlaylist) },
      { key: "Custom HTML", value: player.customHtml ? "Set" : "None" },
    ],
    output,
  );
}
