import { expect, test } from "bun:test";
import { routerSource } from "./source.ts";

// Extracts a top-level function from the generated script, so the tests run the shipped code rather than a mirror of it.
function fnSource(name: string): string {
  const match = routerSource.match(
    new RegExp(`function ${name}\\([^]*?\\n\\}`),
  );
  if (!match) throw new Error(`function ${name} not found in routerSource`);
  return match[0];
}

// A top-level `const NAME = ...;` declaration, for the ones the functions close over.
function constSource(name: string): string {
  const match = routerSource.match(new RegExp(`^const ${name} = .*;$`, "m"));
  if (!match) throw new Error(`const ${name} not found in routerSource`);
  return match[0];
}

// Evaluate the named functions together with the declarations they close over, and hand back the last one.
function load(
  names: string[],
  consts: string[] = [],
): (...args: never[]) => unknown {
  const parts = [
    ...consts.map(constSource),
    ...names.slice(0, -1).map(fnSource),
    `return (${fnSource(names[names.length - 1] as string)});`,
  ];
  return new Function(parts.join("\n"))() as (...args: never[]) => unknown;
}

const indexRetryUrl = load(["indexRetryUrl"]) as (
  rawUrl: string,
  host: string,
) => string | null;

const clientHostname = load(["clientHostname"]) as (request: {
  url: string;
  headers: Map<string, string>;
}) => string;

const matchPath = load(["matchPath"]) as (pathname: string) => string;

interface RedirectRule {
  from: string;
  to: string;
  status: number;
  force: boolean;
}

const parseRedirects = load(
  ["matchPath", "parseRedirects"],
  ["REDIRECT_STATUS"],
) as (text: string) => RedirectRule[];

const parseHeaders = load(["matchPath", "parseHeaders"]) as (
  text: string,
) => Array<{ from: string; entries: Array<[string, string]> }>;

const matchRedirect = load(["ruleSplat", "matchRedirect"]) as (
  rules: RedirectRule[],
  path: string,
  forcedOnly: boolean,
) => RedirectRule | null;

const matchHeaders = load(["ruleSplat", "matchHeaders"]) as (
  rules: Array<{ from: string; entries: Array<[string, string]> }>,
  paths: string[],
) => Map<string, string>;

const defaultCacheControl = load(
  ["defaultCacheControl"],
  ["PAGE_CACHE", "ASSET_CACHE", "PAGE_EXT"],
) as (path: string) => string;

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
  expect(src).toContain("if (retry) {");
  expect(src).toContain(
    "status: 301,\n            headers: { Location: retry }",
  );
  // The client-sent flags must be stripped, or they'd poison cached HTML.
  expect(src).toContain("headers.delete(RETRY_HEADER);");
  expect(src).toContain("headers.delete(PATH_HEADER);");
  expect(src).toContain("headers.delete(RAW_HEADER);");
  // Only a request this router sent to the origin is answered in the response
  // phase; a response the request phase produced itself is already final.
  expect(src).toContain("if (requested === null) return;");
});

// The three names a deploy configures the router with. A framework writes them; nothing here knows which framework.
test("routerSource reads the deploy's own configuration, and nothing else", () => {
  expect(routerSource).toContain('const CONFIG_PATH = "/_bunny/router/";');
  expect(routerSource).toContain(
    'const CONFIG_FILES = ["_redirects", "_headers", "404.html", "404/index.html"];',
  );
  // The reserved path is the whole permission: anything else under `_bunny/` is still forbidden.
  expect(routerSource).toContain(
    'if (wanted === null && (path === "/_bunny" || path.startsWith("/_bunny/")))',
  );
  expect(routerSource).toContain(
    'return new Response("Forbidden", { status: 403 });',
  );
  // The configuration is read per deploy and held, never written into the source.
  expect(routerSource).toContain("const configs = new Map();");
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

// `/about` and `/about/` are one page to every static host, so a rule written either way matches both.
test("matchPath drops the trailing slash, and keeps the root", () => {
  expect(matchPath("/about/")).toBe("/about");
  expect(matchPath("/about")).toBe("/about");
  expect(matchPath("/")).toBe("/");
  expect(matchPath("/a/b//")).toBe("/a/b");
});

test("parseRedirects reads the subset both hosts agree on", () => {
  const rules = parseRedirects(
    [
      "# a comment",
      "",
      "/old /about",
      "/gone /about 302",
      "/forced /about 301!",
      "/blog/* /news/:splat 308",
      "  /indented /about  ",
    ].join("\n"),
  );
  expect(rules).toEqual([
    { from: "/old", to: "/about", status: 301, force: false },
    { from: "/gone", to: "/about", status: 302, force: false },
    { from: "/forced", to: "/about", status: 301, force: true },
    { from: "/blog/*", to: "/news/:splat", status: 308, force: false },
    { from: "/indented", to: "/about", status: 301, force: false },
  ]);
});

// A line this router cannot act on is dropped, not guessed at. A rewrite (200) is deliberately outside the subset.
test("parseRedirects drops what it cannot send", () => {
  expect(
    parseRedirects(
      [
        "/nowhere",
        "relative /about",
        "/spa/* /index.html 200",
        "/x /y 999",
      ].join("\n"),
    ),
  ).toEqual([]);
});

test("parseHeaders reads a path and the lines under it", () => {
  expect(
    parseHeaders(
      [
        "# a comment",
        "/_astro/*",
        "  Cache-Control: public, max-age=31536000, immutable",
        "/about/",
        "  X-Frame-Options: DENY",
        "  Content-Security-Policy: default-src 'self'; img-src *",
        "/empty",
      ].join("\n"),
    ),
  ).toEqual([
    {
      from: "/_astro/*",
      entries: [["Cache-Control", "public, max-age=31536000, immutable"]],
    },
    {
      from: "/about",
      entries: [
        ["X-Frame-Options", "DENY"],
        ["Content-Security-Policy", "default-src 'self'; img-src *"],
      ],
    },
  ]);
});

test("matchRedirect takes the first rule, and fills in the splat", () => {
  const rules = parseRedirects(
    ["/blog/* /news/:splat 301", "/old /about 302!"].join("\n"),
  );
  expect(matchRedirect(rules, "/blog/2026/hello", false)).toMatchObject({
    to: "/news/2026/hello",
    status: 301,
  });
  expect(matchRedirect(rules, "/nothing", false)).toBeNull();
  // A forced rule is the only kind answered before the origin is asked, because it is the only kind that beats a real file.
  expect(matchRedirect(rules, "/blog/x", true)).toBeNull();
  expect(matchRedirect(rules, "/old", true)).toMatchObject({ to: "/about" });
});

test("matchHeaders collects every matching block, and a later one wins", () => {
  const rules = parseHeaders(
    [
      "/*",
      "  X-Frame-Options: SAMEORIGIN",
      "  X-Content-Type-Options: nosniff",
      "/about",
      "  X-Frame-Options: DENY",
    ].join("\n"),
  );
  expect(Object.fromEntries(matchHeaders(rules, ["/about"]))).toEqual({
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
  });
  expect(Object.fromEntries(matchHeaders(rules, ["/other"]))).toEqual({
    "x-frame-options": "SAMEORIGIN",
    "x-content-type-options": "nosniff",
  });
});

// A page is rewritten in place by the next deploy, and a promote purges the edge; a browser may only keep it briefly. The zone's own override is off, so this answer is the one the visitor gets.
test("defaultCacheControl separates a document from everything else", () => {
  expect(defaultCacheControl("/about/")).toBe("public, max-age=60");
  expect(defaultCacheControl("/index.html")).toBe("public, max-age=60");
  expect(defaultCacheControl("/feed.xml")).toBe("public, max-age=60");
  expect(defaultCacheControl("/data.json")).toBe("public, max-age=60");
  expect(defaultCacheControl("/_astro/app.a1b2.js")).toBe(
    "public, max-age=2592000",
  );
  expect(defaultCacheControl("/logo.png")).toBe("public, max-age=2592000");
});
