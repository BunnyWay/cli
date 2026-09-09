import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pushEnvFile } from "./env-push.ts";

/** A compute client that serves no existing entries and records every write. */
function stubClient(putFails?: string) {
  const writes: string[] = [];
  const client = {
    GET: async (path: string) =>
      path.endsWith("/secrets")
        ? { data: { Secrets: [] } }
        : { data: { EdgeScriptVariables: [] } },
    PUT: async (path: string, init: { body: { Name: string } }) => {
      if (init.body.Name === putFails) throw new Error("rejected upstream");
      writes.push(`${init.body.Name}:${path.endsWith("/secrets") ? "s" : "v"}`);
      return { data: {} };
    },
  };
  return { client: client as never, writes };
}

function writeEnv(lines: string[]): string {
  const envPath = join(mkdtempSync(join(tmpdir(), "bunny-push-")), ".env");
  writeFileSync(envPath, lines.join("\n"));
  return envPath;
}

test("--secrets naming a variable the file doesn't have is an error", async () => {
  const { client } = stubClient();
  const file = writeEnv(["STRIPE_SIGNATURE=whsec_x"]);

  await expect(
    pushEnvFile(client, 1, {
      file,
      all: true,
      secrets: ["STRIPE_SIG"],
      output: "text",
    }),
  ).rejects.toThrow(/STRIPE_SIG, which is not in/);
});

test("a rejected write is recorded per variable instead of losing the report", async () => {
  const { client, writes } = stubClient("SECOND");
  const file = writeEnv(["FIRST=a", "SECOND=b", "THIRD=c"]);

  const results = await pushEnvFile(client, 1, {
    file,
    all: true,
    output: "text",
  });

  expect(results.map((r) => [r.name, r.action])).toEqual([
    ["FIRST", "created"],
    ["SECOND", "failed"],
    ["THIRD", "created"],
  ]);
  expect(writes).toEqual(["FIRST:v", "THIRD:v"]);
});
