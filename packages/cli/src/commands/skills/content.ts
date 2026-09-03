import apiMd from "../../../../../skills/bunny-cli/references/api.md" with {
  type: "text",
};
import authMd from "../../../../../skills/bunny-cli/references/auth.md" with {
  type: "text",
};
import databaseMd from "../../../../../skills/bunny-cli/references/database.md" with {
  type: "text",
};
import databaseClientMd from "../../../../../skills/bunny-cli/references/database-client.md" with {
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

This project uses bunny.net. Manage its resources with the \`bunny\` CLI: databases, DNS, storage, Edge Scripts, static sites, and cloud sandboxes.

- Authenticate once with \`bunny login\` (or set \`BUNNYNET_API_KEY\`); verify with \`bunny api GET /user\`.
- Discover commands with \`bunny --help\` and \`bunny <namespace> --help\`; resource commands support \`--output json\` for machine-readable output (a few browser-opening helpers like \`bunny docs\` do not).
- In unattended runs, pass a flag for every value a command would prompt for, and \`--force\` on destructive commands; prompts otherwise block or cancel without a TTY.
- Key namespaces: \`bunny db\` (Bunny Database: create, shell, studio, tokens), \`bunny dns\` (zones, records, presets), \`bunny sites\` (static hosting and deploys), \`bunny scripts\` (Edge Scripts), \`bunny storage\` (Edge Storage zones and files), \`bunny sandbox\` (cloud sandboxes).
- To query a Bunny Database from application code, use \`@bunny.net/database-client\`; it is server-side only, since an auth token grants access to the whole database.
- When the CLI has no command for something, fall back to \`bunny api <METHOD> <path>\` against api.bunny.net.`;

/** The shipped bunny-cli skill, embedded at bundle time from skills/bunny-cli/. */
// Experimental namespaces (apps, registries) stay out of the skill until they stabilize.
export const BUNNY_CLI_SKILL: ProjectSkill = {
  name: "bunny-cli",
  agentsSection: AGENTS_SECTION,
  files: {
    "SKILL.md": skillMd,
    "references/api.md": apiMd,
    "references/auth.md": authMd,
    "references/database-client.md": databaseClientMd,
    "references/database.md": databaseMd,
    "references/dns.md": dnsMd,
    "references/sandbox.md": sandboxMd,
    "references/scripts.md": scriptsMd,
    "references/sites.md": sitesMd,
    "references/storage.md": storageMd,
  },
};
