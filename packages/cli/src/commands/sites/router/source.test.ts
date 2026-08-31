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
  host: string,
) => string | null;

const clientHostname = extractFn("clientHostname") as (request: {
  url: string;
  headers: Map<string, string>;
}) => string;

// A minimal Headers-alike; the router only calls headers.get().
function req(url: string, headers: Record<string, string>) {
  return { url, headers: new Map(Object.entries(headers)) };
}

test("routerSource wires up the deploy routing", () => {
  const src = routerSource;
  expect(src).toContain("bunny sites router");
  // Every host serves the promoted deploy; there is no per-hostname routing.
  expect(src).toContain("process.env.CURRENT_DEPLOY");
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
  // Internal state is never served.
  expect(src).toContain('path.startsWith("/_bunny/")');
  expect(src).toContain('pathname.endsWith(".html")');
  expect(src).toContain(
    'headers.set("Cache-Control", "no-cache, must-revalidate");',
  );
});

// The raw URL at the edge is an internal origin address; the retry target must be rebuilt on the client host so the probe re-enters the CDN and this router.
test("indexRetryUrl targets the directory index on the client host for slashless paths only", () => {
  expect(indexRetryUrl("http://203.0.113.10:9000/blog", "x.b-cdn.net")).toBe(
    "https://x.b-cdn.net/blog/",
  );
  // No dot heuristic: dotted segments retry too, so dotted directories stay reachable.
  expect(
    indexRetryUrl("http://203.0.113.10:9000/v2.1/docs", "x.b-cdn.net"),
  ).toBe("https://x.b-cdn.net/v2.1/docs/");
  // Query strings survive the retry.
  expect(
    indexRetryUrl("http://203.0.113.10:9000/blog?page=2", "x.b-cdn.net"),
  ).toBe("https://x.b-cdn.net/blog/?page=2");
  // Directory and root URLs already expand to an index; no retry.
  expect(
    indexRetryUrl("http://203.0.113.10:9000/blog/", "x.b-cdn.net"),
  ).toBeNull();
  expect(indexRetryUrl("http://203.0.113.10:9000/", "x.b-cdn.net")).toBeNull();
});

// ctx.request.url at the edge is the origin-facing address (`http://<edge-ip>:9000/...`), so the client host must come from the platform's CDN-Host header; the index-retry probe has to land back on the CDN, not the origin.
test("clientHostname prefers CDN-Host, then Host, then the URL", () => {
  expect(
    clientHostname(
      req("http://203.0.113.10:9000/", {
        "cdn-host": "SITE.B-CDN.NET",
        host: "other.example",
      }),
    ),
  ).toBe("site.b-cdn.net");
  expect(
    clientHostname(req("http://203.0.113.10:9000/", { host: "x.b-cdn.net" })),
  ).toBe("x.b-cdn.net");
  expect(clientHostname(req("https://fallback.example/", {}))).toBe(
    "fallback.example",
  );
});
