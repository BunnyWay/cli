import { describe, expect, test } from "bun:test";
import {
  extractAgentToken,
  extractAnycastHost,
  firstContainerId,
  splitHost,
} from "./provision.ts";
import { buildRemoteCommand, resolvePath, shellQuote } from "./sandbox.ts";

describe("buildRemoteCommand", () => {
  test("defaults to the workplace and quotes the command", () => {
    expect(buildRemoteCommand({ cmd: "ls", args: ["-la"] })).toBe(
      "cd '/workplace' && 'ls' '-la'",
    );
  });

  test("honors cwd, sudo, and env", () => {
    expect(
      buildRemoteCommand({
        cmd: "node",
        args: ["app.js"],
        cwd: "/srv",
        sudo: true,
        env: { NODE_ENV: "production" },
      }),
    ).toBe("cd '/srv' && sudo NODE_ENV='production' 'node' 'app.js'");
  });

  test("rejects env names with shell metacharacters", () => {
    expect(() =>
      buildRemoteCommand({ cmd: "ls", env: { "x; rm -rf /": "1" } }),
    ).toThrow("Invalid environment variable name");
  });
});

describe("resolvePath", () => {
  test("keeps absolute paths", () => {
    expect(resolvePath("/etc/hosts")).toBe("/etc/hosts");
  });
  test("resolves relative paths against the workplace", () => {
    expect(resolvePath("src/index.ts")).toBe("/workplace/src/index.ts");
  });
});

describe("shellQuote", () => {
  test("escapes embedded single quotes", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe("splitHost", () => {
  test("defaults to the SSH port", () => {
    expect(splitHost("1.2.3.4")).toEqual({ host: "1.2.3.4", port: 8023 });
  });
  test("parses an explicit port", () => {
    expect(splitHost("1.2.3.4:2222")).toEqual({ host: "1.2.3.4", port: 2222 });
  });
});

describe("app extraction", () => {
  const app = {
    containerTemplates: [
      {
        id: "ct-1",
        environmentVariables: [{ name: "AGENT_TOKEN", value: "secret" }],
        endpoints: [{ type: "anycast", publicHost: "1.2.3.4:8023" }],
      },
    ],
  };

  test("reads the anycast host", () => {
    expect(extractAnycastHost(app)).toBe("1.2.3.4:8023");
  });
  test("recovers the agent token", () => {
    expect(extractAgentToken(app)).toBe("secret");
  });
  test("returns the first container id", () => {
    expect(firstContainerId(app)).toBe("ct-1");
  });
  test("returns null when fields are absent", () => {
    expect(extractAnycastHost({})).toBeNull();
    expect(extractAgentToken({})).toBeNull();
    expect(firstContainerId({})).toBeNull();
  });
});
