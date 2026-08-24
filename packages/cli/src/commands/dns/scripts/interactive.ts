import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import { loadManifest } from "../../../core/manifest.ts";
import { prompts, spinner } from "../../../core/ui.ts";
import {
  type ComputeClient,
  createDnsScript,
  fetchDnsScript,
  fetchDnsScripts,
  publishScript,
  uploadCode,
} from "./api.ts";
import {
  type AnswerKind,
  DNS_SCRIPT_MANIFEST,
  type DnsScriptManifest,
  dnsScriptStarter,
} from "./constants.ts";

/**
 * Resolve a DNS script ID from an explicit value, the linked manifest, or a
 * picker over the account's DNS scripts.
 *
 * Resolution order: explicit `id` -> `.bunny/dns-script.json` -> prompt.
 * Throws when none is available (non-interactive with nothing linked).
 */
export async function resolveDnsScriptId(
  client: ComputeClient,
  id: number | undefined,
  action: string,
  interactive: boolean,
): Promise<number> {
  if (id !== undefined) {
    if (!Number.isFinite(id)) {
      throw new UserError("DNS script ID must be a number.");
    }
    await fetchDnsScript(client, id);
    return id;
  }

  const manifest = loadManifest<DnsScriptManifest>(DNS_SCRIPT_MANIFEST);
  if (manifest.id) {
    // Validate the linked ID; a stale or hand-edited manifest can point at a non-DNS script.
    const script = await fetchDnsScript(client, manifest.id);
    logger.dim(`Using linked DNS script ${script.Name ?? manifest.id}.`);
    return manifest.id;
  }

  if (!interactive) {
    throw new UserError(
      "No DNS script ID provided and none linked.",
      "Pass an ID, or link this directory with `bunny dns scripts link`.",
    );
  }

  const spin = spinner("Fetching DNS scripts...");
  spin.start();
  let scripts: Awaited<ReturnType<typeof fetchDnsScripts>>;
  try {
    scripts = await fetchDnsScripts(client);
  } finally {
    spin.stop();
  }

  if (scripts.length === 0) {
    throw new UserError(
      "No DNS scripts found.",
      "Create one with `bunny dns scripts create`.",
    );
  }

  const { value } = await prompts({
    type: "select",
    name: "value",
    message: `DNS script to ${action}:`,
    choices: scripts.map((s) => ({
      title: `${s.Name ?? "(unnamed)"} (${s.Id})`,
      value: s.Id,
    })),
  });
  if (value === undefined) throw new UserError("A DNS script is required.");
  return value;
}

const CREATE_NEW = -1;

/**
 * Pick an existing DNS script, or create a new one seeded with starter code so
 * the record it backs is never dead. Returns the chosen script's id and name.
 *
 * Used by `dns records add` when the user opts for a script-computed answer.
 * A newly created script is uploaded and published with a `handleQuery` that
 * returns `starterKind` (an A record when omitted).
 */
export async function pickOrCreateDnsScript(
  client: ComputeClient,
  opts: { starterKind?: AnswerKind; defaultName?: string } = {},
): Promise<{ id: number; name: string }> {
  const spin = spinner("Fetching DNS scripts...");
  spin.start();
  let scripts: Awaited<ReturnType<typeof fetchDnsScripts>>;
  try {
    scripts = await fetchDnsScripts(client);
  } finally {
    spin.stop();
  }

  const { value } = await prompts({
    type: "select",
    name: "value",
    message: "DNS script:",
    choices: [
      ...scripts
        .filter((s) => s.Id != null)
        .map((s) => ({
          title: `${s.Name ?? "(unnamed)"} (${s.Id})`,
          value: s.Id as number,
        })),
      { title: "+ Create a new DNS script", value: CREATE_NEW },
    ],
  });
  if (value === undefined) throw new UserError("A DNS script is required.");

  if (value !== CREATE_NEW) {
    const found = scripts.find((s) => s.Id === value);
    return { id: value, name: found?.Name ?? String(value) };
  }

  const { name } = await prompts({
    type: "text",
    name: "name",
    message: "New script name:",
    initial: opts.defaultName ?? "dns-script",
  });
  if (!name) throw new UserError("A script name is required.");

  const createSpin = spinner(`Creating DNS script "${name}"...`);
  createSpin.start();
  let created: { id: number; name: string };
  try {
    created = await createDnsScript(client, name);
    await uploadCode(client, created.id, dnsScriptStarter(opts.starterKind));
    await publishScript(client, created.id);
  } finally {
    createSpin.stop();
  }

  logger.success(`Created DNS script "${created.name}" (${created.id}).`);
  logger.dim(`  Edit locally: bunny dns scripts link ${created.id}`);
  return created;
}
