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

const withDeploy = extractFn("withDeploy") as (
  id: string,
  value: string,
) => string;
const indexRetryUrl = extractFn("indexRetryUrl") as (
  rawUrl: string,
) => string | null;

test("routerSource wires up the preview machinery", () => {
  const src = routerSource;
  expect(src).toContain("bunny sites router");
  // Serves the promoted deploy at the apex and per-deploy path previews.
  expect(src).toContain("process.env.CURRENT_DEPLOY");
  expect(src).toContain('url.pathname = "/deploys/" + deploy + path;');
  // Directory URLs expand to index.html before any branching, so path previews get it too.
  expect(src).toContain(
    'if (url.pathname.endsWith("/")) url.pathname += "index.html";',
  );
  // Flags previews so the response phase rewrites their HTML (and never production's).
  expect(src).toContain('const PREVIEW_HEADER = "x-bunny-preview";');
  // Slashless 404s probe the directory index and redirect to the slash URL, after the exact lookup misses.
  expect(src).toContain('const RETRY_HEADER = "x-bunny-index-retry";');
  expect(src).toContain("if (retry && response.status === 404)");
  expect(src).toContain("{ status: 301, headers: { Location: retry } }");
  // Client-sent flags must be stripped, or they'd poison cached HTML.
  expect(src).toContain("headers.delete(PREVIEW_HEADER);");
  expect(src).toContain("headers.delete(RETRY_HEADER);");
  expect(src).toContain("new HTMLRewriter()");
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
  expect(indexRetryUrl("https://x.b-cdn.net/deploys/abcd/blog")).toBe(
    "https://x.b-cdn.net/deploys/abcd/blog/",
  );
  // Query strings survive the retry.
  expect(indexRetryUrl("https://x.b-cdn.net/blog?page=2")).toBe(
    "https://x.b-cdn.net/blog/?page=2",
  );
  // Directory and root URLs already expand to an index; no retry.
  expect(indexRetryUrl("https://x.b-cdn.net/blog/")).toBeNull();
  expect(indexRetryUrl("https://x.b-cdn.net/")).toBeNull();
});

test("withDeploy prefixes only root-absolute, un-prefixed paths", () => {
  expect(withDeploy("abcd", "/assets/main.css")).toBe(
    "/deploys/abcd/assets/main.css",
  );
  // Already prefixed; left alone (idempotent).
  expect(withDeploy("abcd", "/deploys/abcd/x.js")).toBe("/deploys/abcd/x.js");
  // Protocol-relative, absolute, relative, and anchors are untouched.
  expect(withDeploy("abcd", "//cdn.example.com/x.js")).toBe(
    "//cdn.example.com/x.js",
  );
  expect(withDeploy("abcd", "https://x.com/a.css")).toBe("https://x.com/a.css");
  expect(withDeploy("abcd", "assets/main.css")).toBe("assets/main.css");
  expect(withDeploy("abcd", "#section")).toBe("#section");
});
