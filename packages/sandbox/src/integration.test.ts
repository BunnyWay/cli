import { describe, expect, test } from "bun:test";
import { Sandbox } from "./index.ts";

// Live test against a real bunny.net account. Skipped unless both
// BUNNYNET_API_KEY and SANDBOX_INTEGRATION=1 are set, so it never runs
// during normal `bun test` or in CI. It provisions a real app, connects
// over SSH, exercises the SDK, then deletes the app.
const RUN =
  !!process.env.BUNNYNET_API_KEY && process.env.SANDBOX_INTEGRATION === "1";

const suite = RUN ? describe : describe.skip;
const TIMEOUT_MS = 240_000;
const region = process.env.SANDBOX_REGION ?? "AMS";

suite("sandbox integration", () => {
  test(
    "create, exec, file IO, detached logs, delete",
    async () => {
      const sandbox = await Sandbox.create({
        name: `it-${Date.now().toString(36)}`,
        region,
      });

      try {
        // Capture stdout from a blocking command.
        const echo = await sandbox.runCommand("echo", ["hello-sandbox"]);
        expect(echo.exitCode).toBe(0);
        expect((await echo.stdout()).trim()).toBe("hello-sandbox");

        // Buffer a file in and read it back.
        await sandbox.writeFiles([
          { path: "note.txt", content: "from the integration test" },
        ]);
        const buf = await sandbox.readFile("note.txt");
        expect(buf?.toString()).toBe("from the integration test");

        // Missing files resolve to null.
        expect(await sandbox.readFile("does-not-exist.txt")).toBeNull();

        // Stream output from a detached command.
        const cmd = await sandbox.runCommand({
          cmd: "sh",
          args: ["-c", "echo one; echo two"],
          detached: true,
        });
        let output = "";
        for await (const chunk of cmd.logs()) output += chunk.data;
        const finished = await cmd.wait();
        expect(finished.exitCode).toBe(0);
        expect(output).toContain("one");
        expect(output).toContain("two");
      } finally {
        await sandbox.delete().catch(() => {});
      }
    },
    TIMEOUT_MS,
  );
});
