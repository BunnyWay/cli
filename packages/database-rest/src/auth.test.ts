import { describe, expect, test } from "bun:test";
import { type RequireAuthOptions, requireAuth } from "./auth.ts";

const TOKEN = "secret";

const run = ({
  opts,
  headers,
  path = "/",
}: {
  opts: RequireAuthOptions;
  headers?: Record<string, string>;
  path?: string;
}) =>
  requireAuth(
    () => new Response("ok"),
    opts,
  )(new Request(`http://localhost${path}`, { headers }));

describe("requireAuth", () => {
  test("401 with WWW-Authenticate when no credentials", async () => {
    const res = await run({ opts: { token: TOKEN } });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(
      'Bearer realm="database-rest"',
    );
  });

  test.each([
    ["valid bearer", "Bearer secret", 200],
    ["case-insensitive scheme", "bearer secret", 200],
    ["wrong bearer token", "Bearer nope", 401],
    ["non-bearer scheme", "Basic secret", 401],
  ])("bearer: %s", async (_, authorization, expected) => {
    const res = await run({
      opts: { token: TOKEN },
      headers: { authorization },
    });
    expect(res.status).toBe(expected);
  });

  test.each([
    [
      "matching cookie",
      { cookieName: "session" },
      "session=secret; other=foo",
      200,
    ],
    ["wrong cookie", { cookieName: "session" }, "session=nope", 401],
    ["cookie ignored when cookieName unset", {}, "session=secret", 401],
  ])("cookie: %s", async (_, extra, cookie, expected) => {
    const res = await run({
      opts: { token: TOKEN, ...extra },
      headers: { cookie },
    });
    expect(res.status).toBe(expected);
  });

  test.each([
    ["public path skips auth", "/auth", 200],
    ["non-public path still gated", "/data", 401],
  ])("isPublic: %s", async (_, path, expected) => {
    const res = await run({
      opts: { token: TOKEN, isPublic: (p) => p === "/auth" },
      path,
    });
    expect(res.status).toBe(expected);
  });
});
