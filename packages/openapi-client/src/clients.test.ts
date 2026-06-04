import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ApiError } from "./errors.ts";
import { createCoreClient, createStorageClient } from "./index.ts";
import { captureError, jsonResponse } from "./test-helpers.ts";

let originalFetch: typeof fetch;
let calls: Request[];

beforeEach(() => {
  originalFetch = globalThis.fetch;
  calls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(responder: (request: Request) => Response): void {
  globalThis.fetch = (async (request: Request) => {
    calls.push(request);
    return responder(request);
  }) as unknown as typeof fetch;
}

function get(client: { GET: unknown }, path: string): Promise<unknown> {
  return (client.GET as (p: string) => Promise<unknown>)(path);
}

describe("client factories", () => {
  test("createCoreClient returns a usable openapi-fetch client", () => {
    const client = createCoreClient({ apiKey: "k" });
    expect(typeof client.GET).toBe("function");
    expect(typeof client.POST).toBe("function");
    expect(typeof client.use).toBe("function");
  });

  test("targets the default Core base URL and injects auth headers", async () => {
    stubFetch(() => jsonResponse({ Items: [] }, 200));
    const client = createCoreClient({ apiKey: "secret-key" });

    await get(client, "/region");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.bunny.net/region");
    expect(calls[0]?.headers.get("AccessKey")).toBe("secret-key");
    expect(calls[0]?.headers.get("User-Agent")).toBe("bunnynet-api");
  });

  test("honors a custom baseUrl (region-specific Storage endpoint)", async () => {
    stubFetch(() => jsonResponse({}, 200));
    const client = createStorageClient({
      apiKey: "zone-password",
      baseUrl: "https://la.storage.bunnycdn.com",
    });

    await get(client, "/my-zone/");

    expect(calls[0]?.url).toBe("https://la.storage.bunnycdn.com/my-zone/");
  });

  test("a non-OK JSON response surfaces as a normalized ApiError", async () => {
    stubFetch(() =>
      jsonResponse({ Message: "Zone not found.", Field: "ZoneId" }, 404),
    );
    const client = createCoreClient({ apiKey: "k" });

    const error = (await captureError(get(client, "/region"))) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(404);
    expect(error.message).toBe("Zone not found.");
    expect(error.field).toBe("ZoneId");
  });
});
