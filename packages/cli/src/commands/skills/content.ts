import apiMd from "../../../../../skills/bunny-cli/references/api.md" with {
  type: "text",
};
import authMd from "../../../../../skills/bunny-cli/references/auth.md" with {
  type: "text",
};
import databaseMd from "../../../../../skills/bunny-cli/references/database.md" with {
  type: "text",
};
import dnsMd from "../../../../../skills/bunny-cli/references/dns.md" with {
  type: "text",
};
import sandboxMd from "../../../../../skills/bunny-cli/references/sandbox.md" with {
  type: "text",
};
import scriptsMd from "../../../../../skills/bunny-cli/references/scripts.md" with {
  type: "text",
};
import sitesMd from "../../../../../skills/bunny-cli/references/sites.md" with {
  type: "text",
};
import storageMd from "../../../../../skills/bunny-cli/references/storage.md" with {
  type: "text",
};
import skillMd from "../../../../../skills/bunny-cli/SKILL.md" with {
  type: "text",
};
import type { ProjectSkill } from "../../core/agent-skill.ts";

const AGENTS_SECTION = `## bunny.net CLI

This project uses bunny.net. Manage its resources with the \`bunny\` CLI: databases, DNS, storage, Edge Scripts, static sites, Magic Containers, and cloud sandboxes.

- Authenticate once with \`bunny login\` (or set \`BUNNYNET_API_KEY\`); verify with \`bunny api GET /user\`.
- Discover commands with \`bunny --help\` and \`bunny <namespace> --help\`; every command supports \`--output json\` for machine-readable output.
- Interactive prompts are skipped automatically in non-TTY runs; pass \`--force\` explicitly on destructive commands in scripts.
- Key namespaces: \`bunny db\` (Bunny Database: create, shell, studio, tokens), \`bunny dns\` (zones, records, presets), \`bunny sites\` (static hosting and deploys), \`bunny scripts\` (Edge Scripts), \`bunny storage\` (zones and files), \`bunny apps\` (Magic Containers), \`bunny sandbox\` (cloud sandboxes).
- When the CLI has no command for something, fall back to \`bunny api <METHOD> <path>\` against api.bunny.net.`;

/** The shipped bunny-cli skill, embedded at bundle time from skills/bunny-cli/. */
export const BUNNY_CLI_SKILL: ProjectSkill = {
  name: "bunny-cli",
  agentsSection: AGENTS_SECTION,
  files: {
    "SKILL.md": skillMd,
    "references/api.md": apiMd,
    "references/auth.md": authMd,
    "references/database.md": databaseMd,
    "references/dns.md": dnsMd,
    "references/sandbox.md": sandboxMd,
    "references/scripts.md": scriptsMd,
    "references/sites.md": sitesMd,
    "references/storage.md": storageMd,
  },
};
