import { realpathSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, relative, sep } from "node:path";
import { UserError } from "@/core/errors.ts";
import { formatBytes } from "@/core/format.ts";

/** Edge Scripting's cap on a script's code. */
export const MAX_SCRIPT_BYTES = 10 * 1024 * 1024;

const VIRTUAL_ENTRY = "bunny:entry";
const VIRTUAL_NAMESPACE = "bunny-entry";
const BUILTIN_NAMESPACE = "node-builtin";
// Bun lists its own modules among the builtins; the edge runtime has none of them.
const NODE_BUILTINS = new Set(
  builtinModules.filter((name) => !name.startsWith("bun")),
);
const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;
const BUN_GLOBAL_RE = /\bBun\.[A-Za-z]/;

// `node:` and `npm:` resolve at runtime on the edge; everything else is bundled or refused.
const RUNTIME_SPECIFIER_RE = /^(node|npm):/;
const UNSUPPORTED_SPECIFIER_RE = /^(jsr:|https?:|bun$|bun:)/;

export interface EdgeScriptBundle {
  code: string;
  /** Things that bundle but may fail on the edge, such as a reference to the Bun global. */
  warnings: string[];
}

/** Throw when code is over the Edge Script size cap; `label` names the script in the message. */
export function assertScriptSize(code: string, label: string): void {
  const bytes = Buffer.byteLength(code);
  if (bytes <= MAX_SCRIPT_BYTES) return;
  throw new UserError(
    `${label} is ${formatBytes(bytes)}, over the ${formatBytes(MAX_SCRIPT_BYTES)} Edge Script limit.`,
    "Trim its dependencies, or move large assets into storage.",
  );
}

// Named re-exports from the runtime module; Bun mis-bundles `export *` from an external, so the names come from Bun's own copy.
async function builtinShim(name: string): Promise<string> {
  const names = Object.keys(await import(`node:${name}`)).filter(
    (key) => key !== "default" && IDENTIFIER_RE.test(key),
  );
  return [
    `import * as m from "node:${name}";`,
    names.length > 0 ? `export const { ${names.join(", ")} } = m;` : "",
    "export default m.default ?? m;",
  ].join("\n");
}

// Bun labels each inlined module with a cwd-relative path comment; re-rooting them keeps local paths out of the upload and the hash identical wherever the deploy runs.
function rerootModuleComments(code: string, root: string): string {
  // Bun reports real paths, so a symlinked root (macOS /var -> /private/var) must be resolved to match.
  const rel = relative(realpathSync(process.cwd()), realpathSync(root));
  if (!rel) return code;
  const prefix = `// ${rel.split(sep).join("/")}/`;
  return code
    .split("\n")
    .map((line) =>
      line.startsWith(prefix) ? `// ${line.slice(prefix.length)}` : line,
    )
    .join("\n");
}

/** Bundle an Edge Script for the Deno-based runtime: local files and dependencies are inlined, `node:`/`npm:` imports stay for the runtime, bare builtins gain the `node:` prefix Deno requires, and `jsr:`, URL, and Bun imports are refused. */
export async function bundleEdgeScript(opts: {
  /** Entry file, or generated `source` for an in-memory entry. */
  entry?: string;
  source?: string;
  /** Directory the output's module comments are relative to (default: the entry's). */
  root?: string;
  label: string;
}): Promise<EdgeScriptBundle> {
  const { entry, source, label } = opts;
  if (!entry && source === undefined) {
    throw new UserError(`${label} has nothing to bundle.`);
  }
  const refused = new Set<string>();

  const result = await Bun.build({
    entrypoints: [source === undefined ? (entry as string) : VIRTUAL_ENTRY],
    target: "browser",
    format: "esm",
    throw: false,
    plugins: [
      {
        name: "bunny-edge-runtime",
        setup(build) {
          build.onResolve({ filter: RUNTIME_SPECIFIER_RE }, (args) => ({
            path: args.path,
            external: true,
          }));
          build.onResolve({ filter: UNSUPPORTED_SPECIFIER_RE }, (args) => {
            refused.add(args.path);
            return { path: args.path, external: true };
          });
          build.onResolve({ filter: /^[a-z_][\w/]*$/ }, (args) =>
            NODE_BUILTINS.has(args.path)
              ? { path: args.path, namespace: BUILTIN_NAMESPACE }
              : undefined,
          );
          build.onLoad(
            { filter: /.*/, namespace: BUILTIN_NAMESPACE },
            async (args) => ({
              contents: await builtinShim(args.path),
              loader: "js",
            }),
          );
          if (source === undefined) return;
          build.onResolve({ filter: /^bunny:entry$/ }, () => ({
            path: VIRTUAL_ENTRY,
            namespace: VIRTUAL_NAMESPACE,
          }));
          build.onLoad({ filter: /.*/, namespace: VIRTUAL_NAMESPACE }, () => ({
            contents: source,
            loader: "ts",
          }));
        },
      },
    ],
  });

  if (refused.size > 0) {
    throw new UserError(
      `${label} imports ${[...refused].sort().join(", ")}, which Edge Scripts can't use.`,
      "Add the npm package to package.json (or import it as npm:<name>); Bun APIs don't exist on the Deno-based edge runtime.",
    );
  }
  const output = result.outputs[0];
  if (!result.success || !output) {
    throw new UserError(
      `Couldn't bundle ${label}.`,
      result.logs.map(String).join("\n"),
    );
  }

  const root = opts.root ?? (entry ? dirname(entry) : process.cwd());
  const code = rerootModuleComments(await output.text(), root);
  assertScriptSize(code, label);
  const warnings = BUN_GLOBAL_RE.test(code)
    ? [
        `${label} references the Bun global, which the edge runtime doesn't have; it fails there unless guarded.`,
      ]
    : [];
  return { code, warnings };
}
