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

// previewDeployId closes over the hostname regex, so both are extracted and evaluated together.
function extractPreviewDeployId(): (hostname: string) => string | null {
  const hostRe = routerSource.match(/const PREVIEW_ZONE_HOST = .*;/);
  const fn = routerSource.match(/function previewDeployId\([\s\S]*?\n\}/);
  if (!hostRe || !fn) throw new Error("previewDeployId not found");
  return new Function(`${hostRe[0]}\nreturn (${fn[0]});`)() as (
    hostname: string,
  ) => string | null;
}

const previewDeployId = extractPreviewDeployId();

test("routerSource wires up the deploy routing", () => {
  const src = routerSource;
  expect(src).toContain("bunny sites router");
  // Serves the promoted deploy on production hosts and each deploy on its own preview-zone host.
  expect(src).toContain("process.env.CURRENT_DEPLOY");
  expect(src).toContain(
    "const PREVIEW_ZONE_HOST = /^sites-dpl-([a-z0-9]{4,40})-[a-z0-9]{6}",
  );
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

// The hostname is the entire preview routing contract: preview-zone hosts serve their deploy, everything else serves production.
test("previewDeployId parses preview-zone hostnames only", () => {
  expect(previewDeployId("sites-dpl-a1b2c3d4-x1y2z3.b-cdn.net")).toBe(
    "a1b2c3d4",
  );
  expect(previewDeployId("SITES-DPL-A1B2C3D4-X1Y2Z3.B-CDN.NET")).toBe(
    "a1b2c3d4",
  );
  // A site's own zone, a custom domain, and a nested lookalike all serve production.
  expect(previewDeployId("sites-my-site-x1y2z3.b-cdn.net")).toBeNull();
  expect(previewDeployId("shop.example.com")).toBeNull();
  expect(previewDeployId("sites-dpl-a1b2c3d4-x1y2z3.example.com")).toBeNull();
});
