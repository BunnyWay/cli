import { describe, expect, test } from "bun:test";
import { ApiError } from "./errors.ts";
import {
  authMiddleware,
  type ClientOptions,
  redactSecrets,
} from "./middleware.ts";
import { captureError, jsonResponse } from "./test-helpers.ts";

function runRequest(options: ClientOptions, request: Request) {
  const mw = authMiddleware(options);
  return mw.onRequest!({ request } as never) as Promise<Request>;
}

/**
 * A request that records every attempt to clone or consume its body, so a test
 * can prove the middleware left a large binary upload untouched.
 */
function spyRequest(url: string, init: RequestInit) {
  const request = new Request(url, init);
  const reads: string[] = [];
  const spied = ["clone", "json", "text", "arrayBuffer", "blob"] as const;
  for (const name of spied) {
    const original = Request.prototype[name] as (
      this: Request,
      ...args: unknown[]
    ) => unknown;
    Object.defineProperty(request, name, {
      value: (...args: unknown[]) => {
        reads.push(name);
        return original.apply(request, args);
      },
    });
  }
  return { request, reads };
}

function runResponse(
  options: ClientOptions,
  response: Response,
  parseAs: "json" | "text" = "json",
): Promise<unknown> {
  const mw = authMiddleware(options);
  return Promise.resolve(
    mw.onResponse!({ response, options: { parseAs } } as never),
  );
}

describe("authMiddleware onRequest", () => {
  test("injects the AccessKey and a default User-Agent", async () => {
    const request = await runRequest(
      { apiKey: "secret-key" },
      new Request("https://api.bunny.net/region"),
    );
    expect(request.headers.get("AccessKey")).toBe("secret-key");
    expect(request.headers.get("User-Agent")).toBe("bunnynet-api");
  });

  test("honors a custom User-Agent", async () => {
    const request = await runRequest(
      { apiKey: "k", userAgent: "bunny-cli/1.2.3" },
      new Request("https://api.bunny.net/region"),
    );
    expect(request.headers.get("User-Agent")).toBe("bunny-cli/1.2.3");
  });

  test("logs the request line only when verbose with an onDebug callback", async () => {
    const logs: string[] = [];
    await runRequest(
      { apiKey: "k", verbose: true, onDebug: (m) => logs.push(m) },
      new Request("https://api.bunny.net/region", { method: "GET" }),
    );
    expect(logs).toContain("→ GET https://api.bunny.net/region");
  });

  // Reading an octet-stream body would buffer a whole video upload into memory just to log it.
  test("never reads a non-JSON request body", async () => {
    const logs: string[] = [];
    const { request, reads } = spyRequest(
      "https://video.bunnycdn.com/library/1/videos/abc",
      {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          "content-length": "12",
        },
        body: new Blob(["binary-bytes"]),
      },
    );

    await runRequest(
      { apiKey: "k", verbose: true, onDebug: (m) => logs.push(m) },
      request,
    );

    expect(reads).toEqual([]);
    expect(logs).toContain(
      "→ Body (application/octet-stream): 12 bytes, not logged",
    );
  });

  test("does not log when onDebug is set but verbose is false", async () => {
    const logs: string[] = [];
    await runRequest(
      { apiKey: "k", verbose: false, onDebug: (m) => logs.push(m) },
      new Request("https://api.bunny.net/region"),
    );
    expect(logs).toEqual([]);
  });
});

describe("authMiddleware onResponse", () => {
  test("passes through an OK JSON response without throwing", async () => {
    const result = await runResponse(
      { apiKey: "k" },
      jsonResponse({ Items: [] }, 200),
    );
    expect(result).toBeUndefined();
  });

  test("normalizes Core/Compute ApiErrorData (Message + Field)", async () => {
    const error = (await captureError(
      runResponse(
        { apiKey: "k" },
        jsonResponse({ Message: "Bad zone.", Field: "ZoneId" }, 400),
      ),
    )) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.message).toBe("Bad zone.");
    expect(error.field).toBe("ZoneId");
  });

  test("normalizes Magic Containers RFC 7807 (detail + errors[])", async () => {
    const errors = [{ field: "image", message: "must be linux/amd64" }];
    const error = (await captureError(
      runResponse(
        { apiKey: "k" },
        jsonResponse(
          { title: "Bad Request", detail: "Invalid image.", errors },
          422,
        ),
      ),
    )) as ApiError;
    expect(error.status).toBe(422);
    expect(error.message).toBe("Invalid image.");
    expect(error.validationErrors).toEqual(errors);
  });

  test("falls back to RFC 7807 title when there is no detail", async () => {
    const error = (await captureError(
      runResponse({ apiKey: "k" }, jsonResponse({ title: "Conflict" }, 409)),
    )) as ApiError;
    expect(error.message).toBe("Conflict");
  });

  // Stream's StatusModel uses a lowercase message, which the Core extractor misses.
  test("normalizes the Stream StatusModel (lowercase message)", async () => {
    const error = (await captureError(
      runResponse(
        { apiKey: "k" },
        jsonResponse(
          { success: false, message: "URL validation failed", statusCode: 400 },
          400,
        ),
      ),
    )) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.message).toBe("URL validation failed");
  });

  test("uses a friendly status message for an empty error body", async () => {
    const error = (await captureError(
      runResponse({ apiKey: "k" }, new Response(null, { status: 401 })),
    )) as ApiError;
    expect(error.status).toBe(401);
    expect(error.message).toBe("Unauthorized. Check your API key.");
  });

  test("falls back to a generic message for an unknown empty-body status", async () => {
    const error = (await captureError(
      runResponse({ apiKey: "k" }, new Response(null, { status: 418 })),
    )) as ApiError;
    expect(error.message).toBe("API request failed (418).");
  });

  test("throws when an OK response carries a non-JSON body (proxy/CDN interception)", async () => {
    const error = (await captureError(
      runResponse(
        { apiKey: "k" },
        new Response("<html>Captive portal</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    )) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(200);
    expect(error.message).toContain("non-JSON");
    expect(error.message).toContain("Captive portal");
  });

  test("allows an OK response with a non-JSON but empty body", async () => {
    const result = await runResponse(
      { apiKey: "k" },
      new Response("", {
        status: 204,
        headers: { "content-type": "text/plain" },
      }),
    );
    expect(result).toBeUndefined();
  });

  test("allows an OK text/plain download body when parseAs is text (e.g. DNS zone-file export)", async () => {
    const result = await runResponse(
      { apiKey: "k" },
      new Response("$ORIGIN example.com.\nwww IN CNAME example.b-cdn.net.", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
      "text",
    );
    expect(result).toBeUndefined();
  });

  test("allows an OK application/octet-stream download body when parseAs is text", async () => {
    const result = await runResponse(
      { apiKey: "k" },
      new Response("binary-ish payload", {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
      "text",
    );
    expect(result).toBeUndefined();
  });

  test("throws on a non-JSON body when parseAs is json (proxy serving text/plain to a JSON call)", async () => {
    const error = (await captureError(
      runResponse(
        { apiKey: "k" },
        new Response("upstream connect error", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ),
    )) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toContain("non-JSON");
  });
});

test("redactSecrets walks nested objects and arrays, redacting only secret strings", () => {
  let deep: unknown = { ApiKey: "too-deep" };
  for (let i = 0; i < 10; i++) deep = { next: deep };
  const out = redactSecrets({
    zone: { Name: "z", Password: "p" },
    auth: [{ authToken: "t" }],
    keyCount: 3,
    // A false positive is the safe direction.
    Monkey: "not a secret",
    deep,
  });
  expect(out).toMatchObject({
    zone: { Name: "z", Password: "[redacted]" },
    auth: [{ authToken: "[redacted]" }],
    keyCount: 3,
    Monkey: "[redacted]",
  });
  // Past the depth limit the walk bails to the marker rather than the raw value.
  expect(JSON.stringify(out)).not.toContain("too-deep");
});

test("verbose response body dumps are redacted", async () => {
  const logs: string[] = [];
  await runResponse(
    { apiKey: "k", verbose: true, onDebug: (m) => logs.push(m) },
    jsonResponse({ Id: 1, Name: "my-library", ApiKey: "rw-secret" }, 200),
  );
  const dump = logs.join("\n");
  expect(dump).toContain("my-library");
  expect(dump).not.toContain("rw-secret");
  expect(dump).toContain("[redacted]");
});

test("verbose request body dumps are redacted and read from a clone", async () => {
  const logs: string[] = [];
  const { request, reads } = spyRequest(
    "https://video.bunnycdn.com/library/1/videos/fetch",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com/v.mp4",
        headers: { Authorization: "Bearer origin-secret" },
      }),
    },
  );
  await runRequest(
    { apiKey: "k", verbose: true, onDebug: (m) => logs.push(m) },
    request,
  );
  const dump = logs.join("\n");
  expect(dump).toContain("https://example.com/v.mp4");
  expect(dump).not.toContain("origin-secret");
  // The request about to be sent must keep its body unread.
  expect(reads).toEqual(["clone"]);
});
