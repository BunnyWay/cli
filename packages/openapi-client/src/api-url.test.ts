import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createComputeClient,
  createCoreClient,
  createDbClient,
  createMcClient,
  createOriginErrorsClient,
  createShieldClient,
  createStorageClient,
  createStreamClient,
} from "./index.ts";
import { jsonResponse } from "./test-helpers.ts";

let originalFetch: typeof fetch;
let urls: string[];

beforeEach(() => {
  originalFetch = globalThis.fetch;
  urls = [];
  globalThis.fetch = (async (request: Request) => {
    urls.push(request.url);
    return jsonResponse({}, 200);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function firstUrl(client: { GET: unknown }, path: string) {
  await (client.GET as (p: string) => Promise<unknown>)(path);
  return urls[0];
}

const API_URL = "http://127.0.0.1:8080/proxy/api.bunny.net";

describe("apiUrl", () => {
  test.each([
    ["Core", createCoreClient, "https://api.bunny.net/pullzone"],
    [
      "Edge Scripting",
      createComputeClient,
      "https://api.bunny.net/compute/script",
    ],
    ["Shield", createShieldClient, "https://api.bunny.net/shield/zones"],
    ["Database", createDbClient, "https://api.bunny.net/database/v2/databases"],
    ["Magic Containers", createMcClient, "https://api.bunny.net/mc/apps"],
  ] as const)("%s keeps its default without apiUrl", async (_, create, url) => {
    const path = new URL(url).pathname.replace(/^\/(database|mc)/, "");
    expect(await firstUrl(create({ apiKey: "k" }), path)).toBe(url);
  });

  test.each([
    ["Core", createCoreClient, "/pullzone", `${API_URL}/pullzone`],
    [
      "Edge Scripting",
      createComputeClient,
      "/compute/script",
      `${API_URL}/compute/script`,
    ],
    ["Shield", createShieldClient, "/shield/zones", `${API_URL}/shield/zones`],
    [
      "Database",
      createDbClient,
      "/v2/databases",
      `${API_URL}/database/v2/databases`,
    ],
    ["Magic Containers", createMcClient, "/apps", `${API_URL}/mc/apps`],
  ] as const)("%s derives its base from apiUrl", async (_, create, path, url) => {
    expect(await firstUrl(create({ apiKey: "k", apiUrl: API_URL }), path)).toBe(
      url,
    );
  });

  test("a trailing slash on apiUrl does not double the separator", async () => {
    const client = createDbClient({ apiKey: "k", apiUrl: `${API_URL}/` });
    expect(await firstUrl(client, "/v2/databases")).toBe(
      `${API_URL}/database/v2/databases`,
    );
  });

  test("an explicit baseUrl wins over apiUrl", async () => {
    const client = createDbClient({
      apiKey: "k",
      apiUrl: API_URL,
      baseUrl: "https://db.example.test/database",
    });
    expect(await firstUrl(client, "/v2/databases")).toBe(
      "https://db.example.test/database/v2/databases",
    );
  });

  test.each([
    ["Storage", createStorageClient, "https://storage.bunnycdn.com/zone/"],
    [
      "Stream",
      createStreamClient,
      "https://video.bunnycdn.com/library/1/videos",
    ],
    [
      "Origin Errors",
      createOriginErrorsClient,
      "https://cdn-origin-logging.bunny.net/x",
    ],
  ] as const)("%s ignores apiUrl (different host)", async (_, create, url) => {
    const client = create({ apiKey: "k", apiUrl: API_URL });
    expect(await firstUrl(client, new URL(url).pathname)).toBe(url);
  });
});
