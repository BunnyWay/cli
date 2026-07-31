import { expect, test } from "bun:test";
import { routerSource } from "./source.ts";

// Extracts a top-level function from the generated script and evaluates it, so tests run the shipped code rather than a mirror of it.
function extractFn(name: string): (...args: unknown[]) => unknown {
  const match = routerSource.match(
    new RegExp(`function ${name}\\([^]*?\\n\\}`),
  );
  if (!match) throw new Error(`function ${name} not found in routerSource`);
  return new Function(`return (${match[0]});`)() as (
    ...args: unknown[]
  ) => unknown;
}

const indexRetryUrl = extractFn("indexRetryUrl") as (
  rawUrl: string,
) => string | null;

test("routerSource wires up the deploy routing", () => {
  const src = routerSource;
  expect(src).toContain("bunny sites router");
  // Serves the promoted deploy at the apex and each deploy on its dpl-{id}.preview.* host.
  expect(src).toContain("process.env.CURRENT_DEPLOY");
  expect(src).toContain("const PREVIEW_HOST = /^dpl-([a-z0-9]{4,40})");
  expect(src).toContain('url.pathname = "/deploys/" + deploy + path;');
  // Directory URLs expand to index.html before any branching.
  expect(src).toContain(
    'if (url.pathname.endsWith("/")) url.pathname += "index.html";',
  );
  // Slashless 404s probe the directory index and redirect to the slash URL, after the exact lookup misses.
  expect(src).toContain('const RETRY_HEADER = "x-bunny-index-retry";');
  expect(src).toContain("if (retry && ctx.response.status === 404)");
  expect(src).toContain("{ status: 301, headers: { Location: retry } }");
  // The client-sent flag must be stripped, or it'd poison cached HTML.
  expect(src).toContain("headers.delete(RETRY_HEADER);");
  expect(src).toContain("X-Robots-Tag");
  // Path previews are gone: deploys are only reachable at the apex or a preview host.
  expect(src).not.toContain("HTMLRewriter");
  expect(src).not.toContain("x-bunny-preview");
});

test("indexRetryUrl targets the directory index for slashless paths only", () => {
  expect(indexRetryUrl("https://x.b-cdn.net/blog")).toBe(
    "https://x.b-cdn.net/blog/",
  );
  // No dot heuristic: dotted segments retry too, so dotted directories stay reachable.
  expect(indexRetryUrl("https://x.b-cdn.net/v2.1/docs")).toBe(
    "https://x.b-cdn.net/v2.1/docs/",
  );
  // Query strings survive the retry.
  expect(indexRetryUrl("https://x.b-cdn.net/blog?page=2")).toBe(
    "https://x.b-cdn.net/blog/?page=2",
  );
  // Directory and root URLs already expand to an index; no retry.
  expect(indexRetryUrl("https://x.b-cdn.net/blog/")).toBeNull();
  expect(indexRetryUrl("https://x.b-cdn.net/")).toBeNull();
});
