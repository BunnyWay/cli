import { readFileSync } from "node:fs";
import {
  PLAYER_CONTROLS,
  PLAYER_DEFAULTS,
  type PlayerChanges,
  type PlayerControl,
} from "@bunny.net/tools/stream";
import type { Argv } from "yargs";
import { UserError } from "@/core/errors.ts";
import { parseCsvFlag } from "../flags.ts";

export interface PlayerFlags {
  language?: string;
  font?: string;
  color?: string;
  captionColor?: string;
  captionBackground?: string;
  captionSize?: number;
  /** A CSV list, `""` for `--controls` alone (restore defaults), or `false` for `--no-controls`. */
  controls?: string | false;
  speeds?: string;
  customHtml?: string;
  heatmap?: boolean;
  rememberPosition?: boolean;
  compactControls?: boolean;
  legacyPlayer?: boolean;
  playerVersion?: number;
  captionsInPlaylist?: boolean;
}

export function withPlayerOptions<T>(yargs: Argv<T>): Argv<T & PlayerFlags> {
  return yargs
    .option("language", {
      type: "string",
      describe: "Player UI language, as an ISO 639-1 code (e.g. en)",
    })
    .option("font", { type: "string", describe: "Font family, e.g. Rubik" })
    .option("color", {
      type: "string",
      describe: "Primary control colour, e.g. #FF7755",
    })
    .option("caption-color", {
      type: "string",
      describe: "Caption text colour, e.g. #FFFFFF",
    })
    .option("caption-background", {
      type: "string",
      describe: "Caption background colour, e.g. #000000",
    })
    .option("caption-size", { type: "number", describe: "Caption font size" })
    .option("controls", {
      type: "string",
      describe: `Controls to show, comma-separated (${PLAYER_CONTROLS.join(", ")}). Alone, restores the defaults; --no-controls turns every control off`,
    })
    .option("speeds", {
      type: "string",
      describe:
        "Playback speeds, comma-separated: presets 0.25-4 or custom values like 1.15",
    })
    .option("custom-html", {
      type: "string",
      describe: "File with custom HTML/CSS for the player head",
    })
    .option("heatmap", {
      type: "boolean",
      describe: "Show the watch-time heatmap",
    })
    .option("remember-position", {
      type: "boolean",
      describe: "Resume where the viewer left off",
    })
    .option("compact-controls", {
      type: "boolean",
      describe: "Use the smaller player UI",
    })
    .option("legacy-player", {
      type: "boolean",
      describe:
        "Use the legacy player (PlayerVersion 1); --no-legacy-player uses the current one (2)",
    })
    .option("player-version", {
      type: "number",
      choices: [1, 2],
      describe: "Raw PlayerVersion: 1 = legacy, 2 = current",
    })
    .option("captions-in-playlist", {
      type: "boolean",
      describe:
        "Signal captions in the HLS master playlist for third-party players",
    }) as unknown as Argv<T & PlayerFlags>;
}

function parseControls(value: string | false): PlayerChanges["controls"] {
  if (value === false) return false;
  // `--controls` with no value restores the default set.
  if (value.trim() === "")
    return [...PLAYER_DEFAULTS.controls] as PlayerControl[];
  const entries = parseCsvFlag(value).map((entry) => entry.toLowerCase());
  const invalid = entries.filter(
    (entry) => !(PLAYER_CONTROLS as readonly string[]).includes(entry),
  );
  if (invalid.length > 0) {
    throw new UserError(
      `Invalid --controls value(s): ${invalid.join(", ")}.`,
      `Valid values: ${PLAYER_CONTROLS.join(", ")}.`,
    );
  }
  return entries as PlayerControl[];
}

/** Turn the flags into tool changes, validating as early as possible. Only passed flags appear. */
export function playerChangesFromFlags(flags: PlayerFlags): PlayerChanges {
  const changes: PlayerChanges = {};
  if (flags.language !== undefined) changes.language = flags.language.trim();
  if (flags.font !== undefined) changes.font = flags.font;
  if (flags.color !== undefined) changes.color = flags.color;
  if (flags.captionColor !== undefined)
    changes.captionColor = flags.captionColor;
  if (flags.captionBackground !== undefined)
    changes.captionBackground = flags.captionBackground;
  if (flags.captionSize !== undefined) changes.captionSize = flags.captionSize;
  if (flags.controls !== undefined)
    changes.controls = parseControls(flags.controls);
  if (flags.speeds !== undefined) changes.speeds = parseCsvFlag(flags.speeds);
  if (flags.customHtml !== undefined) {
    try {
      changes.customHtml = readFileSync(flags.customHtml, "utf8");
    } catch {
      throw new UserError(
        `Could not read --custom-html file ${flags.customHtml}.`,
      );
    }
  }
  if (flags.heatmap !== undefined) changes.heatmap = flags.heatmap;
  if (flags.rememberPosition !== undefined)
    changes.rememberPosition = flags.rememberPosition;
  if (flags.compactControls !== undefined)
    changes.compactControls = flags.compactControls;
  if (flags.legacyPlayer !== undefined && flags.playerVersion !== undefined) {
    throw new UserError(
      "Pass either --legacy-player/--no-legacy-player or --player-version, not both.",
    );
  }
  if (flags.legacyPlayer !== undefined)
    changes.playerVersion = flags.legacyPlayer ? 1 : 2;
  if (flags.playerVersion !== undefined) {
    if (flags.playerVersion !== 1 && flags.playerVersion !== 2) {
      throw new UserError(
        "--player-version must be 1 (legacy) or 2 (current).",
      );
    }
    changes.playerVersion = flags.playerVersion;
  }
  if (flags.captionsInPlaylist !== undefined)
    changes.captionsInPlaylist = flags.captionsInPlaylist;
  return changes;
}
