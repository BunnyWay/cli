/**
 * Putting the adapter into somebody's project.
 *
 * Editing a configuration file is only acceptable when the result is obviously
 * right. So this handles two shapes and no more: the config `astro create`
 * writes, and the one line another host's adapter occupies. Anything else gets
 * the exact lines to paste, and the command stops.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../../../core/errors.ts";
import { logger } from "../../../core/logger.ts";
import {
  detectWorkspace,
  installCommand,
  readPackageJson,
  uninstallCommand,
} from "../../../core/package-manager.ts";
import { confirm, isInteractive } from "../../../core/ui.ts";

/** The adapter this command deploys with. */
export const ADAPTER_PACKAGE = "@bunny.net/astro-adapter";

/** Is the adapter already a dependency of the project? */
export async function hasAdapter(root: string, pkg: string): Promise<boolean> {
  const json = await readPackageJson(root);
  const deps = {
    ...(json?.dependencies as Record<string, string> | undefined),
    ...(json?.devDependencies as Record<string, string> | undefined),
  };
  return Boolean(deps[pkg]);
}

/** The project's Astro config file, whichever extension it uses. */
export function findAstroConfig(root: string): string | undefined {
  for (const name of [
    "astro.config.mjs",
    "astro.config.js",
    "astro.config.ts",
    "astro.config.mts",
  ]) {
    const path = join(root, name);
    if (existsSync(path)) return path;
  }
  return undefined;
}

/**
 * Adapters people move to bunny.net from.
 *
 * Replacing one is a mechanical edit: the import goes, and the `adapter` value
 * becomes ours. Naming them is what lets the CLI say "this project uses
 * @astrojs/cloudflare" instead of "the config needs one more change".
 */
const VENDOR_ADAPTERS = [
  "@astrojs/cloudflare",
  "@astrojs/vercel",
  "@astrojs/netlify",
  "@astrojs/node",
  "@astrojs/deno",
  "@deno/astro-adapter",
  "astro-sst",
  "@sveltejs/adapter-auto",
];

/** What the adapter is called in a config this writes. */
const LOCAL_NAME = "bunny";

export interface ConfigPatch {
  /** The new config source. */
  source: string;
  /** The adapter package this took out of the config, when it replaced one. */
  replaced?: string;
}

/** The end of the call that starts at `open`, by counting brackets. */
function endOfCall(source: string, open: number): number | null {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (char === "(" || char === "{" || char === "[") depth++;
    else if (char === ")" || char === "}" || char === "]") {
      depth--;
      if (depth === 0) return i + 1;
    } else if (char === '"' || char === "'" || char === "`") {
      // Skip the string, so a bracket inside it does not count.
      for (i++; i < source.length; i++) {
        if (source[i] === "\\") i++;
        else if (source[i] === char) break;
      }
    }
  }
  return null;
}

/** The import statement that brings `local` into the file. */
function importOf(
  source: string,
  local: string,
): { text: string; from: string } | null {
  const pattern = new RegExp(
    `^import\\s+${local}\\s*(?:,\\s*\\{[^}]*\\}\\s*)?from\\s*["']([^"']+)["'];?\\s*$`,
    "m",
  );
  const match = pattern.exec(source);
  return match ? { text: match[0], from: match[1] ?? "" } : null;
}

/**
 * Add the adapter to an Astro config, replacing another vendor's when one is
 * there.
 *
 * Returns the new source, or null when the config is not one this can edit
 * safely. Editing somebody's configuration is only acceptable when the result is
 * obviously right, so this handles the shape `astro create` writes, and the one
 * line another host's adapter occupies.
 *
 * It does not touch `output`. Since Astro 5 a project that says nothing gets
 * prerendered pages, and a page asks for the edge with
 * `export const prerender = false`. Setting `output: "server"` on such a project
 * turns every page into one that renders per request: measured on
 * `withastro/astro.build`, it took the script from 7.83 MB to 22.30 MB and
 * prerendered none of its 4499 pages.
 */
export function patchAstroConfig(
  source: string,
  pkg: string,
): ConfigPatch | null {
  if (source.includes(pkg)) return { source };

  if (!/defineConfig\(\{/.test(source)) return null;

  const lastImport = [...source.matchAll(/^import .*?;?$/gm)].pop();
  if (lastImport?.index === undefined) return null;

  // An adapter already in the config: replace it when it is one we know, and
  // leave it alone when it is not.
  const existing = /(\n[ \t]*adapter\s*:\s*)([A-Za-z_$][\w$]*)\s*\(/.exec(
    source,
  );
  if (existing) {
    const local = existing[2] ?? "";
    const found = importOf(source, local);
    if (!found || !VENDOR_ADAPTERS.includes(found.from)) return null;

    const callStart = existing.index + existing[0].length - 1;
    const callEnd = endOfCall(source, callStart);
    if (callEnd === null) return null;

    // `import cloudflare from "@bunny.net/astro-adapter"` would work and read
    // like a mistake, so the name changes with the package. It only stays when
    // the file already has something called `bunny`.
    const name = new RegExp(`\\b${LOCAL_NAME}\\b`).test(source)
      ? local
      : LOCAL_NAME;
    const withAdapter = `${source.slice(0, callStart - local.length)}${name}()${source.slice(callEnd)}`;
    // The import keeps its place, so the file's order is the one it had.
    return {
      source: withAdapter.replace(found.text, `import ${name} from "${pkg}";`),
      replaced: found.from,
    };
  }

  const importEnd = lastImport.index + lastImport[0].length;
  const withImport = `${source.slice(0, importEnd)}\nimport ${LOCAL_NAME} from "${pkg}";${source.slice(importEnd)}`;

  // Re-find the call: the import above moved it.
  const call = /defineConfig\(\{/.exec(withImport);
  if (call?.index === undefined) return null;
  const insertAt = call.index + call[0].length;

  return {
    source: `${withImport.slice(0, insertAt)}\n  adapter: ${LOCAL_NAME}(),${withImport.slice(insertAt)}`,
  };
}

/** What to tell a developer whose config this cannot edit. */
function manualSnippet(pkg: string): string {
  return [
    `import bunny from "${pkg}";`,
    "",
    "export default defineConfig({",
    "  adapter: bunny(),",
    "});",
  ].join("\n");
}

async function run(command: string, cwd: string): Promise<void> {
  logger.info(`Running: ${command}`);
  const shell =
    process.platform === "win32"
      ? ["cmd", "/c", command]
      : ["sh", "-c", command];
  const proc = Bun.spawn(shell, {
    cwd,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await proc.exited) !== 0) {
    throw new UserError(`\`${command}\` failed.`);
  }
}

/**
 * Put the adapter into this project, asking first.
 *
 * Installing is always the developer's choice. An unattended run reports the two
 * changes and stops, unless `--yes` says to go ahead: a deploy command that
 * silently rewrites a config in CI is worse than one that refuses.
 */
export async function ensureAdapter(opts: {
  root: string;
  output: string | undefined;
  /** `--yes`: make the changes without asking. */
  assumeYes: boolean;
}): Promise<void> {
  const { root, output } = opts;
  const pkg = ADAPTER_PACKAGE;

  const installed = await hasAdapter(root, pkg);
  const configPath = findAstroConfig(root);
  const source = configPath ? await Bun.file(configPath).text() : null;
  const configured = source?.includes(pkg) ?? false;
  if (installed && configured) return;

  const workspace = await detectWorkspace(root);
  const install = installCommand(workspace, pkg);
  // What is in the way, when something is: another host's adapter.
  const inTheWay = source === null ? null : vendorAdapterIn(source);
  const file = configPath?.split("/").pop() ?? "the Astro config";

  // The adapter it replaces has to leave the project, not only the config.
  // `@astrojs/node@9` peers on `astro@^5`, so once Astro is 7 it makes every
  // later `npm install` in that project fail with an unrelated-looking
  // ERESOLVE. Taking it out is the same change as replacing it in the config.
  const stale =
    inTheWay && (await hasAdapter(root, inTheWay)) ? inTheWay : null;
  const uninstall = stale ? uninstallCommand(workspace, stale) : null;

  if (configPath === undefined) {
    throw new UserError(
      `This project has no Astro config file, so the adapter cannot be set.`,
      [
        "Create astro.config.mjs with:",
        "",
        'import { defineConfig } from "astro/config";',
        manualSnippet(pkg),
      ].join("\n"),
    );
  }

  const asking = !opts.assumeYes;
  if (asking && !isInteractive(output)) {
    logger.warn(`This project has no bunny.net adapter.`);
    if (uninstall) logger.dim(`  ${uninstall}`);
    if (!installed) logger.dim(`  ${install}`);
    if (!configured) {
      if (inTheWay) {
        logger.dim(`  In ${file}, replace ${inTheWay} with ${pkg}.`);
      }
      logger.dim(`  ${manualSnippet(pkg)}`);
    }
    throw new UserError(
      "The adapter is not in this project yet.",
      "Make the changes above, or re-run with --yes to have this command make them.",
    );
  }

  if (asking) {
    const wanted = await confirm(
      inTheWay
        ? `Replace ${inTheWay} with ${pkg}?`
        : installed
          ? `Add ${pkg} to ${file}?`
          : `Add ${pkg} to this project?`,
      { initial: true },
    );
    if (!wanted) {
      throw new UserError(
        "Nothing was deployed.",
        `Without an adapter, Astro cannot build a route that renders on demand.`,
      );
    }
  }

  // Out before in: leaving the old adapter's peer range in place is what makes
  // the install fail.
  if (uninstall) await run(uninstall, root);
  if (!installed) await run(install, root);

  if (!configured) {
    const patch = source === null ? null : patchAstroConfig(source, pkg);
    if (patch === null) {
      throw new UserError(
        `${installed ? "This project has" : "Installed"} ${pkg}, and ${file} needs one change this cannot make safely.`,
        [
          ...(inTheWay
            ? [`Take out the ${inTheWay} adapter, and add this:`]
            : ["Add this:"]),
          "",
          manualSnippet(pkg),
          "",
          "Then run `bunny lab deploy astro` again.",
        ].join("\n"),
      );
    }
    await Bun.write(configPath, patch.source);
    logger.success(
      patch.replaced
        ? `Replaced ${patch.replaced} with ${pkg} in ${file}.`
        : `Added the adapter to ${file}.`,
    );
  }
}

/** The vendor adapter a config already uses, when it uses one. */
export function vendorAdapterIn(source: string): string | undefined {
  const existing = /\n[ \t]*adapter\s*:\s*([A-Za-z_$][\w$]*)\s*\(/.exec(source);
  const local = existing?.[1];
  if (!local) return undefined;
  const from = importOf(source, local)?.from;
  return from && from !== "astro/config" ? from : undefined;
}
