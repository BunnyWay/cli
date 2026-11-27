import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createCoreClient, createStreamClient } from "./index.ts";
import { retryAfterMs, retryingFetch } from "./retry.ts";
import { captureError, jsonResponse } from "./test-helpers.ts";

let originalFetch: typeof fetch;
let calls: Request[];
let sleeps: number[];

beforeEach(() => {
  originalFetch = globalThis.fetch;
  calls = [];
  sleeps = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(
  statuses: number[],
  headers: Record<string, string> = {},
): void {
  globalThis.fetch = (async (request: Request) => {
    calls.push(request);
    const status = statuses[calls.length - 1] ?? 200;
    return status === 200
      ? jsonResponse({ ok: true }, 200)
      : new Response(null, { status, headers });
  }) as unknown as typeof fetch;
}

const sleep = async (ms: number) => {
  sleeps.push(ms);
};

describe("retryingFetch", () => {
  test("retries a 429 with growing backoff, then returns the success", async () => {
    stubFetch([429, 429, 200]);
    const res = await retryingFetch({ sleep, random: () => 0 })(
      new Request("https://api.bunny.net/pullzone"),
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  test("gives up after maxRetries and returns the last 429", async () => {
    stubFetch([429, 429, 429]);
    const res = await retryingFetch({ maxRetries: 2, sleep })(
      new Request("https://api.bunny.net/pullzone"),
    );
    expect(res.status).toBe(429);
    expect(calls).toHaveLength(3);
  });

  test("honours Retry-After, and returns at once when it asks for over 30 s", async () => {
    stubFetch([429, 200], { "retry-after": "2" });
    await retryingFetch({ sleep })(new Request("https://api.bunny.net/x"));
    expect(sleeps).toEqual([2000]);

    calls = [];
    sleeps = [];
    stubFetch([429, 200], { "retry-after": "120" });
    const res = await retryingFetch({ sleep })(
      new Request("https://api.bunny.net/x"),
    );
    expect(res.status).toBe(429);
    expect(sleeps).toEqual([]);
  });

  test("resends a JSON body on every attempt", async () => {
    stubFetch([429, 200]);
    await retryingFetch({ sleep })(
      new Request("https://api.bunny.net/storagezone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ Name: "a" }),
      }),
    );
    expect(await Promise.all(calls.map((c) => c.text()))).toEqual([
      '{"Name":"a"}',
      '{"Name":"a"}',
    ]);
  });

  test("never retries (or clones) a binary upload", async () => {
    stubFetch([429, 200]);
    const res = await retryingFetch({ sleep })(
      new Request("https://storage.bunnycdn.com/zone/file.bin", {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array([1, 2, 3]),
      }),
    );
    expect(res.status).toBe(429);
    expect(calls).toHaveLength(1);
  });

  test("stops waiting and does not resend once the caller aborts", async () => {
    stubFetch([429, 200]);
    const controller = new AbortController();
    const request = new Request("https://api.bunny.net/x", {
      signal: controller.signal,
    });
    const pending = retryingFetch()(request);
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    expect(calls).toHaveLength(1);
  });

  test("does not wait at all when the caller aborted before the wait", async () => {
    const controller = new AbortController();
    globalThis.fetch = (async (request: Request) => {
      calls.push(request);
      controller.abort(new Error("cancelled"));
      return new Response(null, { status: 429 });
    }) as unknown as typeof fetch;
    await expect(
      retryingFetch({ sleep })(
        new Request("https://api.bunny.net/x", { signal: controller.signal }),
      ),
    ).rejects.toThrow("cancelled");
    expect(sleeps).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  test("rejects a retry budget that is not a non-negative integer", () => {
    for (const maxRetries of [Number.NaN, 2.5, -1, Number.POSITIVE_INFINITY]) {
      expect(() => retryingFetch({ maxRetries })).toThrow(TypeError);
    }
  });

  test("does not retry other errors", async () => {
    stubFetch([500, 200]);
    const res = await retryingFetch({ sleep })(
      new Request("https://api.bunny.net/x"),
    );
    expect(res.status).toBe(500);
    expect(calls).toHaveLength(1);
  });
});

describe("retryAfterMs", () => {
  test("parses seconds and HTTP dates", () => {
    expect(retryAfterMs("3")).toBe(3000);
    expect(
      retryAfterMs("Thu, 01 Jan 2026 00:00:10 GMT", Date.UTC(2026, 0, 1)),
    ).toBe(10_000);
    expect(retryAfterMs(null)).toBeUndefined();
    expect(retryAfterMs("soon")).toBeUndefined();
  });
});

test("client factories retry through the shared fetch", async () => {
  stubFetch([429, 200], { "retry-after": "0" });
  const { data } = await createCoreClient({ apiKey: "k" }).GET("/region");
  expect(data).toEqual({ ok: true } as never);
  expect(calls).toHaveLength(2);
  expect(calls[1]?.headers.get("AccessKey")).toBe("k");
});

test("reports each retry through onDebug in verbose mode", async () => {
  stubFetch([429, 200], { "retry-after": "0" });
  const messages: string[] = [];
  await retryingFetch({ verbose: true, onDebug: (m) => messages.push(m) })(
    new Request("https://api.bunny.net/pullzone?search=x"),
  );
  expect(messages).toEqual([
    "← 429 on https://api.bunny.net/pullzone, retry 1 in 0 ms",
  ]);
});

test("the Stream client leaves 429s to its callers", async () => {
  stubFetch([429, 200]);
  const error = await captureError(
    createStreamClient({ apiKey: "k" }).GET("/library/{libraryId}/videos", {
      params: { path: { libraryId: 1 } },
    } as never),
  );
  expect((error as { status?: number }).status).toBe(429);
  expect(calls).toHaveLength(1);
});
