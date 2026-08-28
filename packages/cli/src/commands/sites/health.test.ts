import { afterEach, expect, test } from "bun:test";
import { findDeployFault, findMissingPageFault, health } from "./health.ts";

const realFetch = globalThis.fetch;
const realWait = health.wait;

afterEach(() => {
  globalThis.fetch = realFetch;
  health.wait = realWait;
});

/** Answer each call with the next status, and record what was asked for. */
function answerWith(statuses: Array<number | "throw">): string[] {
  const asked: string[] = [];
  let call = 0;
  health.wait = () => Promise.resolve();
  globalThis.fetch = ((url: string) => {
    asked.push(url);
    const status = statuses[Math.min(call++, statuses.length - 1)];
    if (status === "throw") return Promise.reject(new Error("unreachable"));
    return Promise.resolve(new Response(null, { status }));
  }) as typeof fetch;
  return asked;
}

test("a page is a working site", async () => {
  answerWith([200]);
  expect(await findDeployFault("https://site.test", "abc")).toBeNull();
});

// A script that answers 404 or redirects is a script that ran.
test("a 404 and a redirect are answers, not faults", async () => {
  answerWith([404]);
  expect(await findDeployFault("https://site.test", "abc")).toBeNull();
  answerWith([301]);
  expect(await findDeployFault("https://site.test", "abc")).toBeNull();
});

// The 400 a script that will not start answers, on every attempt.
test("reports a 400 that does not go away", async () => {
  const asked = answerWith([400]);
  expect(await findDeployFault("https://site.test", "abc")).toBe(400);
  expect(asked.length).toBe(3);
  // Each probe carries its own query, so no answer can come from the CDN cache.
  expect(new Set(asked).size).toBe(3);
});

test("gives a cold start the chance to warm up", async () => {
  answerWith([400, 200]);
  expect(await findDeployFault("https://site.test", "abc")).toBeNull();
});

test("reports a 5xx", async () => {
  answerWith([503]);
  expect(await findDeployFault("https://site.test", "abc")).toBe(503);
});

// DNS or TLS not being ready is not the deploy's verdict.
test("says nothing when the site cannot be reached", async () => {
  answerWith(["throw"]);
  expect(await findDeployFault("https://site.test", "abc")).toBeNull();
});

/** Answer each call with the next body, and record what was asked for. */
function answerBodies(
  bodies: Array<{ status: number; body: string }>,
): string[] {
  const asked: string[] = [];
  let call = 0;
  health.wait = () => Promise.resolve();
  globalThis.fetch = ((url: string) => {
    asked.push(url);
    const next = bodies[Math.min(call++, bodies.length - 1)] as {
      status: number;
      body: string;
    };
    return Promise.resolve(new Response(next.body, { status: next.status }));
  }) as typeof fetch;
  return asked;
}

const PAGE = "<html><body>nothing here</body></html>";

// The fault that shipped: the zone has no error page of its own, so bunny.net's
// answers every miss and the site's own page is never seen.
test("reports a miss answered by anything but the deploy's own page", async () => {
  const asked = answerBodies([{ status: 404, body: "<html>bunny.net</html>" }]);
  expect(
    await findMissingPageFault({
      url: "https://site.test",
      deployId: "abc",
      page: PAGE,
    }),
  ).toBe(404);
  // A path, not a query: a sites zone ignores query strings, so a cache-buster
  // in the query is the same URL to the cache.
  expect(asked[0]).toBe("https://site.test/_bunny_check/abc/0");
  expect(new Set(asked).size).toBe(3);
});

test("says nothing when the deploy's own page answers", async () => {
  answerBodies([{ status: 404, body: `\n${PAGE}\n` }]);
  expect(
    await findMissingPageFault({
      url: "https://site.test",
      deployId: "abc",
      page: PAGE,
    }),
  ).toBeNull();
});

// A rewrite to 200 is a choice a site may make, and it is not this check's to
// overrule; a 200 is still not a 404, so it is reported and the deploy decides.
test("reports a miss that answered 200", async () => {
  answerBodies([{ status: 200, body: PAGE }]);
  expect(
    await findMissingPageFault({
      url: "https://site.test",
      deployId: "abc",
      page: PAGE,
    }),
  ).toBe(200);
});

// A deploy with no 404 page of its own has nothing to be wrong about.
test("asks nothing when the deploy has no page of its own", async () => {
  const asked = answerBodies([{ status: 404, body: "" }]);
  expect(
    await findMissingPageFault({
      url: "https://site.test",
      deployId: "abc",
      page: null,
    }),
  ).toBeNull();
  expect(asked).toEqual([]);
});

test("gives a fresh deploy the chance to propagate", async () => {
  answerBodies([
    { status: 404, body: "<html>bunny.net</html>" },
    { status: 404, body: PAGE },
  ]);
  expect(
    await findMissingPageFault({
      url: "https://site.test",
      deployId: "abc",
      page: PAGE,
    }),
  ).toBeNull();
});
