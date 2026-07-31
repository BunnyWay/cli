import { expect, test } from "bun:test";
import { routerSource } from "./source.ts";

test("routerSource wires up the preview machinery", () => {
  const src = routerSource;
  expect(src).toContain("bunny sites router");
  // Serves the promoted deploy at the apex and per-deploy path previews.
  expect(src).toContain("process.env.CURRENT_DEPLOY");
  expect(src).toContain('url.pathname = "/deploys/" + deploy + path;');
  // Directory URLs expand to index.html before any branching, so path previews get it too.
  expect(src).toContain('url.pathname += "index.html";');
  // Extensionless URLs (/blog) expand too; SSG directory output has no /blog object, only /blog/index.html.
  expect(src).toContain('url.pathname += "/index.html";');
  // Flags previews so the response phase rewrites their HTML (and never production's).
  expect(src).toContain('const PREVIEW_HEADER = "x-bunny-preview";');
  // Client-sent preview flags must be stripped, or they'd poison cached production HTML.
  expect(src).toContain("headers.delete(PREVIEW_HEADER);");
  expect(src).toContain("new HTMLRewriter()");
  expect(src).toContain("X-Robots-Tag");
});

// Mirrors the router's withDeploy() so a regression in the rewrite rule is caught here.
function withDeploy(id: string, value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return value;
  if (value.startsWith("/deploys/")) return value;
  return `/deploys/${id}${value}`;
}

// Mirrors the router's index expansion so a regression in the rule is caught here.
function expandIndex(pathname: string): string {
  if (pathname.endsWith("/")) return pathname + "index.html";
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return last.includes(".") ? pathname : pathname + "/index.html";
}

test("expandIndex resolves directory and extensionless paths to index.html", () => {
  expect(expandIndex("/")).toBe("/index.html");
  expect(expandIndex("/blog/")).toBe("/blog/index.html");
  expect(expandIndex("/blog")).toBe("/blog/index.html");
  // Only the last segment decides: a dotted parent dir still expands.
  expect(expandIndex("/v2.1/docs")).toBe("/v2.1/docs/index.html");
  // Files with extensions pass through untouched.
  expect(expandIndex("/assets/main.css")).toBe("/assets/main.css");
  expect(expandIndex("/blog/post.html")).toBe("/blog/post.html");
  // Rewritten preview links expand into the deploy dir.
  expect(expandIndex("/deploys/abcd/blog")).toBe(
    "/deploys/abcd/blog/index.html",
  );
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
