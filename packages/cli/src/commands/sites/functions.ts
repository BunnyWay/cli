import { existsSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import {
  createScriptResource,
  fetchScript,
  publishScript,
  uploadScriptCode,
} from "@/commands/scripts/api.ts";
import {
  SCRIPT_MANIFEST,
  SCRIPT_TYPE_STANDALONE,
} from "@/commands/scripts/constants.ts";
import { UserError } from "@/core/errors.ts";
import { saveManifestAt } from "@/core/manifest.ts";
import { type ComputeClient, sha256Hex } from "./api.ts";
import { runBuildCommand } from "./build.ts";
import { detectPackageManager, readPackageJson } from "./ci/frameworks.ts";
import {
  type FunctionRecord,
  functionEnvName,
  functionUrl,
  type RemoteSiteState,
} from "./constants.ts";

export const DEFAULT_FUNCTIONS_DIR = "functions";

const ENTRY_EXTENSIONS = [".ts", ".js", ".mjs"];
const ENTRY_MODULE = "bunny:entry";
const ENTRY_NAMESPACE = "bunny";
const ENTRY_FILTER = /^bunny:entry$/;
const BUILD_OUTPUT_DIR = "dist";

// A name becomes a URL segment and part of the Edge Script name, so it stays lowercase and dash-separated.
const FUNCTION_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
// The compute API caps an Edge Script name at 100 characters.
const MAX_SCRIPT_NAME_LENGTH = 100;

export interface SiteFunction {
  name: string;
  /** Directory the function lives in; a single-file function's is the functions dir itself. */
  dir: string;
  /** True for `functions/<name>/`, which is a script project of its own and gets a `.bunny/script.json`. */
  folder: boolean;
  /** Handler module to bundle; absent when the folder ships its own build. */
  entry?: string;
  /** Build command from the folder's package.json, run instead of bundling. */
  build?: string;
}

/** Edge Script name for a site's function. */
export function functionScriptName(site: string, name: string): string {
  return `sites-${site}-${name}`;
}

function findEntry(dir: string, stems: string[]): string | undefined {
  for (const stem of stems) {
    for (const ext of ENTRY_EXTENSIONS) {
      const candidate = join(dir, `${stem}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function assertValidName(name: string, path: string): void {
  if (!FUNCTION_NAME_RE.test(name)) {
    throw new UserError(
      `Function name "${name}" (${path}) isn't valid.`,
      "Use lowercase letters, digits, and dashes, starting with a letter or digit.",
    );
  }
}

// `hello.ts` next to `hello/` would deploy twice to one script, the last one silently winning.
function assertUniqueName(
  seen: Map<string, string>,
  name: string,
  path: string,
): void {
  const other = seen.get(name);
  if (other) {
    throw new UserError(
      `Function "${name}" is defined twice: ${other} and ${path}.`,
      "Keep one entry per name; a file and a folder can't share it.",
    );
  }
  seen.set(name, path);
}

function assertScriptNameFits(site: string, fn: SiteFunction): void {
  const scriptName = functionScriptName(site, fn.name);
  if (scriptName.length <= MAX_SCRIPT_NAME_LENGTH) return;
  const room = MAX_SCRIPT_NAME_LENGTH - (scriptName.length - fn.name.length);
  throw new UserError(
    `Function "${fn.name}" makes the Edge Script name ${scriptName} longer than ${MAX_SCRIPT_NAME_LENGTH} characters.`,
    `Shorten the function name to ${room} characters or fewer for site ${site}.`,
  );
}

// Each entry in the functions dir is one function: `<name>.ts` (or .js/.mjs), or a folder with `index.*`, `<name>.*`, or a package.json build script. Sorted by name for stable output.
export async function discoverFunctions(
  root: string,
  dir: string = DEFAULT_FUNCTIONS_DIR,
): Promise<SiteFunction[]> {
  const base = resolve(root, dir);
  if (!existsSync(base)) return [];

  const functions: SiteFunction[] = [];
  const seen = new Map<string, string>();
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = join(base, entry.name);

    if (entry.isFile()) {
      const ext = extname(entry.name);
      if (!ENTRY_EXTENSIONS.includes(ext)) continue;
      const name = basename(entry.name, ext);
      assertValidName(name, path);
      assertUniqueName(seen, name, path);
      functions.push({ name, dir: base, folder: false, entry: path });
      continue;
    }
    if (!entry.isDirectory()) continue;

    const name = entry.name;
    assertValidName(name, path);
    assertUniqueName(seen, name, path);
    const handler = findEntry(path, ["index", name]);
    if (handler) {
      functions.push({ name, dir: path, folder: true, entry: handler });
      continue;
    }
    const pkg = await readPackageJson(path);
    const scripts = pkg?.scripts as Record<string, string> | undefined;
    if (scripts?.build) {
      const pm = await detectPackageManager(path);
      functions.push({
        name,
        dir: path,
        folder: true,
        build: `${pm} run build`,
      });
      continue;
    }
    throw new UserError(
      `Function folder ${path} has no entry file.`,
      `Add an index.ts exporting a default \`(request: Request) => Response\` handler, or a package.json build script that writes ${BUILD_OUTPUT_DIR}/index.js.`,
    );
  }
  return functions.sort((a, b) => a.name.localeCompare(b.name));
}

// The generated entry accepts both a bare handler and a `{ fetch }` object, hands it to the Edge Scripting runtime directly (no SDK dependency), and answers CORS for any origin since the frontend calls the function cross-origin; a handler that sets its own Access-Control-Allow-Origin wins.
export function functionEntrySource(handlerPath: string): string {
  return [
    `import handler from ${JSON.stringify(handlerPath)};`,
    'const respond = typeof handler === "function" ? handler : (req) => handler.fetch(req);',
    'const cors = (req) => ({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS", "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") || "*" });',
    "Bunny.v1.serve(async (req) => {",
    '  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });',
    "  const res = await respond(req);",
    '  if (res.headers.has("Access-Control-Allow-Origin")) return res;',
    "  const headers = new Headers(res.headers);",
    "  for (const [k, v] of Object.entries(cors(req))) headers.set(k, v);",
    "  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });",
    "});",
    "",
  ].join("\n");
}

// The generated entry is a virtual module, so nothing is written next to the user's code and the bundle (and its hash) doesn't vary with a temp path.
async function bundleHandler(fn: SiteFunction, entry: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [ENTRY_MODULE],
    target: "browser",
    format: "esm",
    plugins: [
      {
        name: "bunny-function-entry",
        setup(build) {
          build.onResolve({ filter: ENTRY_FILTER }, () => ({
            path: ENTRY_MODULE,
            namespace: ENTRY_NAMESPACE,
          }));
          build.onLoad({ filter: /.*/, namespace: ENTRY_NAMESPACE }, () => ({
            contents: functionEntrySource(entry),
            loader: "ts",
          }));
        },
      },
    ],
  });
  const output = result.outputs[0];
  if (!result.success || !output) {
    throw new UserError(
      `Couldn't bundle function "${fn.name}".`,
      result.logs.map(String).join("\n"),
    );
  }
  return output.text();
}

async function buildWithScript(
  fn: SiteFunction,
  build: string,
): Promise<string> {
  await runBuildCommand(build, fn.dir, {});
  const built = findEntry(join(fn.dir, BUILD_OUTPUT_DIR), ["index"]);
  if (!built) {
    throw new UserError(
      `Function "${fn.name}" built, but wrote no ${BUILD_OUTPUT_DIR}/index.js.`,
      `Point the build at ${BUILD_OUTPUT_DIR}/index.js (or .ts/.mjs), or add an index.ts handler and drop the build script.`,
    );
  }
  return Bun.file(built).text();
}

/** The single file to upload as the function's Edge Script code. */
export async function buildFunction(fn: SiteFunction): Promise<string> {
  if (fn.build) return buildWithScript(fn, fn.build);
  if (fn.entry) return bundleHandler(fn, fn.entry);
  throw new UserError(`Function "${fn.name}" has nothing to build.`);
}

export interface FunctionDeployResult {
  name: string;
  scriptId: number;
  url: string;
  created: boolean;
  /** False when the code hash matched the deployed one and the upload was skipped. */
  uploaded: boolean;
}

// Every deployed function's URL as the variables a build reads; a framework prefix (e.g. VITE_) adds the copy its bundler exposes to browser code.
export function functionBuildEnv(
  state: RemoteSiteState,
  envPrefix?: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, record] of Object.entries(state.functions ?? {})) {
    const url = functionUrl(record.hostname);
    env[functionEnvName(name)] = url;
    if (envPrefix) env[functionEnvName(name, envPrefix)] = url;
  }
  return env;
}

function bareHostname(value: string): string {
  return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

// Create the function's standalone script with a linked pull zone, then read the zone's hostname back (the create response doesn't always carry it).
async function createFunctionScript(
  client: ComputeClient,
  site: string,
  fn: SiteFunction,
): Promise<FunctionRecord> {
  const created = await createScriptResource(client, {
    Name: functionScriptName(site, fn.name),
    ScriptType: SCRIPT_TYPE_STANDALONE,
    CreateLinkedPullZone: true,
  });
  let zone = created.LinkedPullZones?.[0];
  if (!zone?.DefaultHostname) {
    zone = (await fetchScript(client, created.Id)).LinkedPullZones?.[0];
  }
  if (!zone?.DefaultHostname) {
    throw new UserError(
      `Function "${fn.name}" was created as script ${created.Id}, but its pull zone has no hostname yet.`,
      "Re-run the deploy; the zone may still be provisioning.",
    );
  }
  return {
    scriptId: created.Id,
    pullZoneId: zone.Id,
    hostname: bareHostname(zone.DefaultHostname),
  };
}

export interface PreparedFunction {
  fn: SiteFunction;
  code: string;
  codeHash: string;
  record: FunctionRecord;
  created: boolean;
}

// Build every function and create the scripts missing from `state.functions` (mutated; the caller writes state) so their URLs exist before the site builds; nothing is published yet, so a deploy that fails validation later leaves live functions untouched.
export async function prepareFunctions(opts: {
  computeClient: ComputeClient;
  state: RemoteSiteState;
  functions: SiteFunction[];
  onStep?: (message: string) => void;
}): Promise<PreparedFunction[]> {
  const { computeClient, state, functions } = opts;
  const step = opts.onStep ?? (() => {});
  for (const fn of functions) assertScriptNameFits(state.name, fn);
  state.functions ??= {};
  const records = state.functions;
  const prepared: PreparedFunction[] = [];

  for (const fn of functions) {
    step(`Building function ${fn.name}...`);
    const code = await buildFunction(fn);

    // Own-property lookup: a function named `constructor` must not resolve to Object.prototype's.
    let record = Object.hasOwn(records, fn.name) ? records[fn.name] : undefined;
    const created = !record;
    if (!record) {
      step(`Creating function ${fn.name}...`);
      record = await createFunctionScript(computeClient, state.name, fn);
      records[fn.name] = record;
    }

    // A folder function is a script project in its own right: link it so `bunny scripts` commands work from inside it.
    if (fn.folder) {
      saveManifestAt(fn.dir, SCRIPT_MANIFEST, {
        id: record.scriptId,
        name: functionScriptName(state.name, fn.name),
        scriptType: SCRIPT_TYPE_STANDALONE,
      });
    }

    prepared.push({ fn, code, codeHash: sha256Hex(code), record, created });
  }
  return prepared;
}

// Upload and publish prepared code once the site deploy is validated; unchanged code (by hash) skips its upload unless forced. Records are the `state.functions` objects, so the caller writes state afterwards.
export async function publishFunctions(opts: {
  computeClient: ComputeClient;
  prepared: PreparedFunction[];
  force: boolean;
  onStep?: (message: string) => void;
}): Promise<FunctionDeployResult[]> {
  const { computeClient, prepared, force } = opts;
  const step = opts.onStep ?? (() => {});
  const results: FunctionDeployResult[] = [];

  for (const { fn, code, codeHash, record, created } of prepared) {
    const uploaded = force || record.codeHash !== codeHash;
    if (uploaded) {
      step(`Deploying function ${fn.name}...`);
      await uploadScriptCode(computeClient, record.scriptId, code);
      await publishScript(computeClient, record.scriptId);
      record.codeHash = codeHash;
    }
    results.push({
      name: fn.name,
      scriptId: record.scriptId,
      url: functionUrl(record.hostname),
      created,
      uploaded,
    });
  }
  return results;
}

/** Deployed functions whose folder is gone; they keep serving until removed by hand. */
export function staleFunctions(
  state: RemoteSiteState,
  functions: SiteFunction[],
): string[] {
  const present = new Set(functions.map((f) => f.name));
  return Object.keys(state.functions ?? {})
    .filter((name) => !present.has(name))
    .sort();
}
