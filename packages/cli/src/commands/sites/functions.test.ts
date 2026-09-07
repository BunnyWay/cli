import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComputeClient } from "./api.ts";
import { type RemoteSiteState, STATE_VERSION } from "./constants.ts";
import {
  buildFunction,
  discoverFunctions,
  functionBuildEnv,
  prepareFunctions,
  publishFunctions,
} from "./functions.ts";

let root: string;

function scaffold(files: Record<string, string>): void {
  root = mkdtempSync(join(tmpdir(), "bunny-functions-test-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("discovers folder and single-file functions, skipping dot entries", async () => {
  scaffold({
    "functions/hello/index.ts": "export default () => new Response('hi');",
    "functions/bye.ts": "export default () => new Response('bye');",
    "functions/.hidden/index.ts": "",
    "functions/notes.md": "",
  });
  const found = await discoverFunctions(root);
  expect(found.map((f) => f.name)).toEqual(["bye", "hello"]);
  expect(found[1]?.entry).toBe(join(root, "functions/hello/index.ts"));
});

test("rejects a name that can't be a URL segment", async () => {
  scaffold({ "functions/Bad_Name/index.ts": "" });
  await expect(discoverFunctions(root)).rejects.toThrow('"Bad_Name"');
});

test("rejects a file and a folder that derive the same name", async () => {
  scaffold({
    "functions/hello.ts": "export default () => new Response('a');",
    "functions/hello/index.ts": "export default () => new Response('b');",
  });
  await expect(discoverFunctions(root)).rejects.toThrow("defined twice");
});

test("rejects a name whose Edge Script name exceeds the API cap", async () => {
  const name = "f".repeat(63);
  scaffold({
    [`functions/${name}.ts`]: "export default () => new Response();",
  });
  const computeClient = {
    POST: async () => {
      throw new Error("must not reach the API");
    },
  } as unknown as ComputeClient;
  const state: RemoteSiteState = {
    version: STATE_VERSION,
    name: "s".repeat(47),
    storageZoneId: 1,
    pullZoneId: 2,
    deploys: [],
  };
  const functions = await discoverFunctions(root);
  await expect(
    prepareFunctions({ computeClient, state, functions }),
  ).rejects.toThrow("longer than 100");
});

test("bundles a handler into a self-contained script", async () => {
  scaffold({
    "functions/hello/index.ts":
      "import { greet } from './greet.ts';\nexport default () => new Response(greet());",
    "functions/hello/greet.ts": "export const greet = () => 'hello';",
  });
  const [fn] = await discoverFunctions(root);
  const code = await buildFunction(fn!);
  expect(code).toContain("Bunny.v1.serve");
  expect(code).toContain("Access-Control-Allow-Origin");
  expect(code).toContain("hello");
  expect(code).not.toContain("import ");
});

test("prepare creates a script once, publish uploads only changed code", async () => {
  scaffold({
    "functions/hello/index.ts": "export default () => new Response('hi');",
  });
  const calls: string[] = [];
  const computeClient = {
    POST: async (path: string) => {
      calls.push(path);
      return {
        data: {
          Id: 42,
          LinkedPullZones: [{ Id: 7, DefaultHostname: "fn.b-cdn.net" }],
        },
      };
    },
  } as unknown as ComputeClient;
  const state: RemoteSiteState = {
    version: STATE_VERSION,
    name: "my-site",
    storageZoneId: 1,
    pullZoneId: 2,
    deploys: [],
  };
  const functions = await discoverFunctions(root);

  const prepared = await prepareFunctions({ computeClient, state, functions });
  // Creation is persisted in state before anything is published.
  expect(calls).toEqual(["/compute/script"]);
  expect(state.functions?.hello).toMatchObject({ scriptId: 42 });
  expect(state.functions?.hello?.codeHash).toBeUndefined();

  const first = await publishFunctions({
    computeClient,
    prepared,
    force: false,
  });
  expect(first).toEqual([
    {
      name: "hello",
      scriptId: 42,
      url: "https://fn.b-cdn.net",
      created: true,
      uploaded: true,
    },
  ]);
  expect(calls).toEqual([
    "/compute/script",
    "/compute/script/{id}/code",
    "/compute/script/{id}/publish",
  ]);
  expect(state.functions?.hello).toMatchObject({
    scriptId: 42,
    hostname: "fn.b-cdn.net",
  });

  calls.length = 0;
  const again = await prepareFunctions({ computeClient, state, functions });
  const second = await publishFunctions({
    computeClient,
    prepared: again,
    force: false,
  });
  expect(second[0]).toMatchObject({ created: false, uploaded: false });
  expect(calls).toEqual([]);
});

test("a function named constructor is not mistaken for an existing record", async () => {
  scaffold({
    "functions/constructor.ts": "export default () => new Response('c');",
  });
  const computeClient = {
    POST: async () => ({
      data: {
        Id: 9,
        LinkedPullZones: [{ Id: 1, DefaultHostname: "c.b-cdn.net" }],
      },
    }),
  } as unknown as ComputeClient;
  const state: RemoteSiteState = {
    version: STATE_VERSION,
    name: "my-site",
    storageZoneId: 1,
    pullZoneId: 2,
    deploys: [],
  };
  const [prepared] = await prepareFunctions({
    computeClient,
    state,
    functions: await discoverFunctions(root),
  });
  expect(prepared).toMatchObject({ created: true, record: { scriptId: 9 } });
});

test("functionBuildEnv names each URL after its function, plus the framework's public copy", () => {
  const state: RemoteSiteState = {
    version: STATE_VERSION,
    name: "my-site",
    storageZoneId: 1,
    pullZoneId: 2,
    deploys: [],
    functions: { "create-share": { scriptId: 1, hostname: "fn.b-cdn.net" } },
  };
  expect(functionBuildEnv(state, "VITE_")).toEqual({
    BUNNY_FUNCTION_CREATE_SHARE_URL: "https://fn.b-cdn.net",
    VITE_BUNNY_FUNCTION_CREATE_SHARE_URL: "https://fn.b-cdn.net",
  });
});
