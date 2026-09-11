import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHttp, isHttpError } from "./http.ts";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let rateLimited = 0;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/echo") {
        return Response.json({
          query: Object.fromEntries(url.searchParams),
          auth: request.headers.get("authorization"),
          accept: request.headers.get("accept"),
          agent: request.headers.get("user-agent"),
        });
      }
      if (url.pathname === "/limited") {
        if (rateLimited++ < 2) {
          return new Response(null, {
            status: 429,
            headers: { "retry-after": "1" },
          });
        }
        return Response.json({ ok: true, attempts: rateLimited });
      }
      if (url.pathname === "/missing") {
        return Response.json({ message: "gone" }, { status: 404 });
      }
      if (url.pathname === "/slow") {
        return new Promise((resolve) =>
          setTimeout(() => resolve(new Response("late")), 500),
        );
      }
      return new Response("nope", { status: 500 });
    },
  });
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => server.stop(true));

test("sends query params, basic auth, and the caller's headers", async () => {
  const http = createHttp({
    label: "Test",
    baseUrl,
    timeout: 5_000,
    userAgent: "bunny-test",
    auth: { username: "id", password: "secret" },
    headers: { Accept: "application/vnd.test+json" },
  });

  const body = await http.get("/echo", {
    params: { page: 2, skip: undefined },
  });

  expect(body.query).toEqual({ page: "2" });
  expect(body.auth).toBe(`Basic ${btoa("id:secret")}`);
  expect(body.accept).toBe("application/vnd.test+json");
  expect(body.agent).toBe("bunny-test");
});

test("retries a 429 with Retry-After, then throws HttpError with the status and body", async () => {
  const waits: number[] = [];
  const http = createHttp({
    label: "Test",
    baseUrl,
    timeout: 5_000,
    userAgent: "bunny-test",
    wait: async (ms) => {
      waits.push(ms);
    },
  });

  await expect(http.get("/limited")).resolves.toMatchObject({ ok: true });
  expect(waits).toEqual([1_000, 1_000]);

  try {
    await http.get("/missing");
    expect.unreachable();
  } catch (error) {
    expect(isHttpError(error, 404)).toBe(true);
    expect((error as { body: unknown }).body).toEqual({ message: "gone" });
  }
});

test("a timeout becomes a UserError naming the service", async () => {
  const http = createHttp({
    label: "Slowpoke",
    baseUrl,
    timeout: 50,
    userAgent: "bunny-test",
  });

  await expect(http.get("/slow")).rejects.toThrow(/Slowpoke request timed out/);
});
