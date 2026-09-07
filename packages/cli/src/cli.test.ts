import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = new URL("./cli.ts", import.meta.url).pathname;
const CONFIG_PATH = new URL("./config/index.ts", import.meta.url).pathname;
const PROMPTS_PATH = import.meta.resolve("prompts");
let directory: string;
let configFile: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "bunny-cli-errors-"));
  configFile = join(directory, "bunnynet.json");
  writeFileSync(
    configFile,
    JSON.stringify({
      profiles: { staging: { api_key: "stored-secret" } },
      sandboxes: {},
    }),
  );
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

interface RunOptions {
  env?: Record<string, string>;
  response?: { status: number; body?: string; contentType?: string };
  setup?: string;
}

// Separate processes exercise real parsing, exit codes and stream output, with
// temporary credentials and a fake transport so no account or network is used.
async function run(args: string[], options: RunOptions = {}) {
  const fixture = JSON.stringify(options.response ?? null);
  const script = `
    globalThis.fetch = async () => {
      console.error("TEST_API_REQUEST");
      const fixture = ${fixture};
      if (!fixture) throw new Error("Unexpected API request");
      return new Response(fixture.body ?? null, {
        status: fixture.status,
        headers: { "content-type": fixture.contentType ?? "application/json" },
      });
    };
    ${options.setup ?? ""}
    const { cli } = await import(${JSON.stringify(CLI_PATH)});
    await cli.parse(${JSON.stringify(args)});
  `;
  const proc = Bun.spawn({
    cmd: [process.execPath, "-e", script],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: directory,
      XDG_CACHE_HOME: directory,
      BUNNYNET_API_KEY: "",
      BUNNY_API_KEY: "",
      BUNNYNET_API_URL: "https://api.invalid",
      NO_COLOR: "1",
      ...options.env,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), 8000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
  }
}

describe("input errors", () => {
  test.each([
    "text",
    "json",
  ])("missing profiles are user errors (%s)", async (output) => {
    const result = await run(["whoami", "--profile", "nope", "-o", output]);
    expect(result.exitCode).toBe(1);
    const text =
      output === "json"
        ? JSON.stringify(JSON.parse(result.stdout))
        : result.stderr;
    expect(text).toContain("not found");
    expect(text).toContain("bunny config profile list");
    expect(text).not.toContain("unexpected");
    expect(result.stderr).not.toContain("TEST_API_REQUEST");
  });

  test.each(
    [
      ["scripts", "show", "abc"],
      ["scripts", "show", "Infinity"],
      ["scripts", "env", "list", "--id", "abc"],
      ["dns", "records", "add", "--ttl", "abc"],
      ["dns", "records", "add", "--ttl", "2", "--ttl", "abc"],
      ["dns", "records", "add", "--pull-zone", "abc"],
    ].map((args) => ({ args })),
  )("rejects invalid numbers before execution: $args", async ({ args }) => {
    const result = await run([...args, "--output=json"]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error).toContain(
      "expected a finite number",
    );
    expect(result.stderr).not.toContain("TEST_API_REQUEST");
  });

  test.each([
    { args: ["storgae", "list"], suggestion: "Did you mean storage?" },
    {
      args: ["whoami", "--profle", "nope"],
      suggestion: "Did you mean --profile?",
    },
    {
      args: ["--profle=nope", "whoami"],
      suggestion: "Did you mean --profile?",
    },
    {
      args: ["dns", "records", "add", "--commnet", "test"],
      suggestion: "Did you mean --comment?",
    },
    { args: ["dns", "zone", "lst"], suggestion: "Did you mean list?" },
  ])("suggests corrections for $args", async ({ args, suggestion }) => {
    const result = await run([...args, "-o", "json"]);
    expect(result.exitCode).toBe(1);
    const error = JSON.parse(result.stdout);
    expect(`${error.error} ${error.hint}`).toContain(suggestion);
    expect(error.hint).toContain("--help");
  });

  test("text parser errors stay short and do not dump help", async () => {
    const result = await run(["storgae", "list"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Did you mean storage?");
    expect(result.stderr.trim().split("\n")).toHaveLength(2);
  });

  test("unrelated names get usage without an arbitrary suggestion", async () => {
    const result = await run(["zzzzzzzz", "--output", "json"]);
    expect(JSON.parse(result.stdout).hint).toBe(
      "Run `bunny --help` for usage.",
    );
  });

  test("command help groups global flags separately", async () => {
    const result = await run(["dns", "records", "add", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Global options:[\s\S]*--profile/);
    expect(result.stdout).toMatch(/\nOptions:[\s\S]*--ttl/);
  });
});

test("the misspelled API key environment variable warns once without exposing its value", async () => {
  const result = await run(["whoami", "--profile", "nope", "-o", "json"], {
    env: { BUNNY_API_KEY: "misspelled-secret" },
    setup: `const { resolveConfig } = await import(${JSON.stringify(CONFIG_PATH)}); resolveConfig("staging"); resolveConfig("staging");`,
  });
  expect(result.stderr.match(/BUNNY_API_KEY is ignored/g)).toHaveLength(1);
  expect(result.stderr).toContain("BUNNYNET_API_KEY");
  expect(result.stderr).not.toContain("misspelled-secret");
  expect(JSON.parse(result.stdout).error).toContain("not found");
});

describe("authentication errors", () => {
  const sources: {
    args: string[];
    env: Record<string, string>;
    source: string;
  }[] = [
    {
      args: ["--api-key", "flag-secret"],
      env: { BUNNYNET_API_KEY: "env-secret" },
      source: "--api-key",
    },
    {
      args: [],
      env: { BUNNYNET_API_KEY: "env-secret", BUNNY_API_KEY: "typo-secret" },
      source: "BUNNYNET_API_KEY",
    },
    { args: [], env: {}, source: 'profile "staging"' },
  ];
  for (const source of sources) {
    test.each([
      "text",
      "json",
    ])(`401 identifies ${source.source} (%s)`, async (output) => {
      const result = await run(
        ["whoami", "--profile", "staging", ...source.args, "-o", output],
        {
          env: source.env,
          response: {
            status: 401,
            body: '{"Message":"Authorization has been denied for this request."}',
          },
        },
      );
      expect(result.exitCode).toBe(1);
      const payload = output === "json" ? JSON.parse(result.stdout) : null;
      const text = payload ? `${payload.error} ${payload.hint}` : result.stderr;
      expect(text).toContain("Unauthorized. The API key was rejected.");
      expect(text).toContain(`API key source: ${source.source}`);
      expect(text).toContain('bunny login --profile "staging"');
      expect(result.stdout + result.stderr).not.toContain("-secret");
      expect(result.stderr).not.toContain("is ignored");
      if (payload) expect(payload.status).toBe(401);
    });
  }

  test.each(
    [
      ["db", "show", "99999999"],
      ["api", "GET", "/nope"],
    ].map((args) => ({ args })),
  )("empty 401 responses share the same guidance: $args", async ({ args }) => {
    const result = await run(
      [...args, "--api-key", "flag-secret", "-o", "json"],
      { response: { status: 401 } },
    );
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: "Unauthorized. The API key was rejected.",
      status: 401,
    });
    expect(JSON.parse(result.stdout).hint).toContain("bunny login");
  });
});

describe("database lookup errors", () => {
  test.each([
    400, 404, 200,
  ])("missing databases have a list hint (status %i)", async (status) => {
    const result = await run(
      ["db", "show", "99999999", "--profile", "staging", "-o", "json"],
      {
        response: { status, body: status === 200 ? "{}" : undefined },
      },
    );
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      error: "No database found for 99999999.",
      hint: "Run `bunny db list` to see available databases.",
    });
  });

  test.each([
    403, 500,
  ])("unrelated database failures preserve their status (%i)", async (status) => {
    const result = await run(
      ["db", "show", "99999999", "--profile", "staging", "-o", "json"],
      { response: { status } },
    );
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).status).toBe(status);
    expect(result.stdout).not.toContain("No database found");
  });
});

describe("raw API responses", () => {
  test.each([
    "text",
    "json",
  ])("HTML errors use a bounded single-line preview (%s)", async (output) => {
    const result = await run(
      ["api", "GET", "/nope", "--profile", "staging", "-o", output],
      {
        response: {
          status: 404,
          contentType: "text/html",
          body: `<html>\n${"  dashboard page\n".repeat(1000)}</html>`,
        },
      },
    );
    expect(result.exitCode).toBe(1);
    if (output === "json") {
      const payload = JSON.parse(result.stdout);
      expect(payload.status).toBe(404);
      expect(payload.hint.length).toBeLessThanOrEqual(201);
      expect(payload.hint).not.toContain("\n");
    } else {
      expect(result.stderr.length).toBeLessThan(300);
    }
    expect(result.stdout + result.stderr).not.toContain("</html>");
  });

  test("empty errors omit the preview", async () => {
    const result = await run(
      ["api", "GET", "/nope", "--profile", "staging", "-o", "json"],
      { response: { status: 404 } },
    );
    expect(JSON.parse(result.stdout)).toEqual({ error: "404", status: 404 });
  });

  test("successful raw text remains intact", async () => {
    const body = "line one\nline two\n".repeat(100);
    const result = await run(["api", "GET", "/text", "--profile", "staging"], {
      response: { status: 200, body, contentType: "text/plain" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${body}\n`);
  });
});

describe("profile deletion", () => {
  test.each([
    "text",
    "json",
  ])("unattended deletion requires --force (%s)", async (output) => {
    const before = readFileSync(configFile, "utf8");
    const result = await run([
      "config",
      "profile",
      "delete",
      "staging",
      "-o",
      output,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain("--force");
    if (output === "json")
      expect(JSON.parse(result.stdout).error).toContain(
        "requires confirmation",
      );
    expect(readFileSync(configFile, "utf8")).toBe(before);
  });

  test("--force does not silently accept nonexistent profiles", async () => {
    const before = readFileSync(configFile, "utf8");
    const result = await run([
      "config",
      "profile",
      "delete",
      "nope",
      "--force",
      "-o",
      "json",
    ]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error).toBe('Profile "nope" not found.');
    expect(readFileSync(configFile, "utf8")).toBe(before);
  });

  test("--force deletes the profile and reports JSON", async () => {
    const result = await run([
      "config",
      "profile",
      "delete",
      "staging",
      "--force",
      "-o",
      "json",
    ]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      profile: "staging",
      deleted: true,
    });
    expect(JSON.parse(readFileSync(configFile, "utf8")).profiles).toEqual({});
  });

  test.each([
    true,
    false,
  ])("interactive answer %s controls deletion", async (answer) => {
    const result = await run(["config", "profile", "delete", "staging"], {
      setup: `process.stdin.isTTY = true; process.stdout.isTTY = true; const { default: prompts } = await import(${JSON.stringify(PROMPTS_PATH)}); prompts.inject([${answer}]);`,
    });
    expect(result.exitCode).toBe(answer ? 0 : 1);
    const profiles = JSON.parse(readFileSync(configFile, "utf8")).profiles;
    expect(Boolean(profiles.staging)).toBe(!answer);
  });
});
