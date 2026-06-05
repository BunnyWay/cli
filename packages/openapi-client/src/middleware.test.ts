import { describe, expect, test } from "bun:test";
import { ApiError } from "./errors.ts";
import { authMiddleware, type ClientOptions } from "./middleware.ts";
import { captureError, jsonResponse } from "./test-helpers.ts";

function runRequest(options: ClientOptions, request: Request) {
  const mw = authMiddleware(options);
  return mw.onRequest!({ request } as never) as Promise<Request>;
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
