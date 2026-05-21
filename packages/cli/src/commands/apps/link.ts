import { createMcClient } from "@bunny.net/openapi-client";
import type { components } from "@bunny.net/openapi-client/generated/magic-containers.d.ts";
import prompts from "prompts";
import { resolveConfig } from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { logger } from "../../core/logger.ts";
import { loadManifest, saveManifest } from "../../core/manifest.ts";
import { confirm, spinner } from "../../core/ui.ts";
import { APP_MANIFEST, type AppManifest } from "./constants.ts";

type Application = components["schemas"]["Application"];

const COMMAND = "link [app-id]";
const DESCRIPTION = `Link this directory to an existing MC app (writes .bunny/${APP_MANIFEST}).`;

interface LinkArgs {
  "app-id"?: string;
  force?: boolean;
}

export const appsLinkCommand = defineCommand<LinkArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ["$0 apps link", "Interactive selection from all apps on your account"],
    ["$0 apps link app_abc123", "Link directly by ID"],
    [
      "$0 apps link app_abc123 --force",
      "Replace an existing link without prompting",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("app-id", {
        type: "string",
        describe:
          "App ID to link this directory to (omit for interactive selection)",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: `Overwrite an existing .bunny/${APP_MANIFEST} without prompting`,
      }),

  handler: async ({
    "app-id": appIdArg,
    force,
    profile,
    output,
    verbose,
    apiKey,
  }) => {
    const existing = loadManifest<AppManifest>(APP_MANIFEST);
    if (existing.id && !force) {
      const confirmed = await confirm(
        `Already linked to ${existing.id}. Replace?`,
      );
      if (!confirmed) {
        logger.log("Link cancelled.");
        return;
      }
    }

    const config = resolveConfig(profile, apiKey, verbose);
    const client = createMcClient(clientOptions(config, verbose));

    const app = appIdArg
      ? await fetchAppById(client, appIdArg)
      : await pickAppInteractively(client);

    // Carry forward any registry pointers the previous manifest had;
    // re-linking shouldn't lose work the user did via interactive
    // walkthroughs. Container template IDs always come fresh from the
    // API (they're authoritative there).
    const previousContainers = existing.containers ?? {};

    const containers: AppManifest["containers"] = {};
    for (const ct of app.containerTemplates) {
      const previousEntry = previousContainers[ct.name];
      containers[ct.name] = {
        id: ct.id,
        registry:
          ct.imageRegistryId && ct.imageRegistryId !== "0"
            ? ct.imageRegistryId
            : previousEntry?.registry,
      };
    }

    const manifest: AppManifest = {
      id: app.id,
      profile: profile ?? "default",
      containers,
    };

    saveManifest<AppManifest>(APP_MANIFEST, manifest);

    if (output === "json") {
      logger.log(JSON.stringify(manifest, null, 2));
      return;
    }

    logger.success(`Linked to ${app.id} → .bunny/${APP_MANIFEST}`);
    const names = Object.keys(containers);
    if (names.length > 0) {
      logger.dim(`Containers: ${names.join(", ")}`);
    }
    logger.dim("Tip: add `.bunny/` to .gitignore - manifest is per-user.");
  },
});

async function fetchAppById(
  client: ReturnType<typeof createMcClient>,
  appId: string,
): Promise<Application> {
  const spin = spinner("Fetching app...");
  spin.start();
  const { data: app } = await client.GET("/apps/{appId}", {
    params: { path: { appId } },
  });
  spin.stop();

  if (!app) {
    throw new UserError(
      `App ${appId} not found.`,
      "Check the ID is correct and you're authenticated to the right account.",
    );
  }
  return app;
}

/**
 * Fetch every app on the account and let the user pick one. Mirrors
 * `db/link.ts` and `scripts/link.ts` - same affordance for the
 * fresh-clone case where the user knows the app name but not its ID.
 *
 * Returns the full {@link Application} (not just the ID) so the caller
 * can populate the manifest with container template IDs without a
 * second round-trip.
 */
async function pickAppInteractively(
  client: ReturnType<typeof createMcClient>,
): Promise<Application> {
  const spin = spinner("Fetching apps...");
  spin.start();
  const { data } = await client.GET("/apps");
  spin.stop();

  const apps = (data?.items ?? []).filter(
    (a): a is typeof a & { id: string; name: string } =>
      typeof a.id === "string" && typeof a.name === "string",
  );

  if (apps.length === 0) {
    throw new UserError(
      "No apps found on this account.",
      "Run `bunny apps deploy` to create one, or pass an explicit app ID.",
    );
  }

  apps.sort((a, b) => a.name.localeCompare(b.name));

  const { value: selectedId } = await prompts({
    type: "select",
    name: "value",
    message: "Select an app to link:",
    choices: apps.map((a) => ({
      title: `${a.name} (${a.id})`,
      value: a.id,
    })),
  });

  if (!selectedId) {
    throw new UserError("Link cancelled.");
  }

  // The list endpoint returns a slim shape - fetch the full app so
  // we have its `containerTemplates` for the manifest.
  return fetchAppById(client, selectedId);
}
