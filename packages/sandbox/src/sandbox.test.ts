import { describe, expect, test } from "bun:test";
import { CommandTimeoutError } from "./errors.ts";
import {
  extractAgentToken,
  extractAnycastHost,
  extractCdnPorts,
  firstContainerId,
  splitHost,
} from "./provision.ts";
import {
  buildRemoteCommand,
  resolvePath,
  Sandbox,
  shellQuote,
} from "./sandbox.ts";
import { collectExec, fileEntryFromAttrs } from "./transport.ts";

describe("Sandbox.create", () => {
  test("rejects reserved env key AGENT_TOKEN before any network call", async () => {
    await expect(
      Sandbox.create({ env: { AGENT_TOKEN: "user-supplied" } }),
    ).rejects.toThrow('"AGENT_TOKEN" is reserved and cannot be set.');
  });

  test("rejects invalid env key names before any network call", async () => {
    await expect(
      Sandbox.create({ env: { "bad key": "value" } }),
    ).rejects.toThrow("Invalid environment variable name");
  });
});

describe("Sandbox.runCommand validation", () => {
  // fromHandle connects lazily, so validation errors surface with no network.
  const sandbox = Sandbox.fromHandle({
    appId: "app-1",
    name: "test",
    agentToken: "token",
    sshHost: "192.0.2.1",
  });

  test("rejects a non-positive timeout before any network call", async () => {
    await expect(sandbox.runCommand({ cmd: "ls", timeout: 0 })).rejects.toThrow(
      "timeout must be a positive number",
    );
  });

  test("rejects timeout combined with detached", async () => {
    await expect(
      sandbox.runCommand({ cmd: "ls", detached: true, timeout: 5000 }),
    ).rejects.toThrow("not supported with detached");
  });

  test("rejects signal combined with detached", async () => {
    await expect(
      sandbox.runCommand({
        cmd: "ls",
        detached: true,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("not supported with detached");
  });

  test("rejects output callbacks combined with detached", async () => {
    await expect(
      sandbox.runCommand({ cmd: "ls", detached: true, onStdout: () => {} }),
    ).rejects.toThrow("not supported with detached");
    await expect(
      sandbox.runCommand({ cmd: "ls", detached: true, onStderr: () => {} }),
    ).rejects.toThrow("not supported with detached");
  });
});

function fakeStream() {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const stderrListeners: Array<(data: Buffer) => void> = [];
  return {
    signals: [] as string[],
    closed: false,
    on(event: string, cb: (...args: never[]) => void) {
      listeners[event] ??= [];
      listeners[event].push(cb as (...args: unknown[]) => void);
      return this;
    },
    stderr: {
      on(_event: string, cb: (data: Buffer) => void) {
        stderrListeners.push(cb);
        return this;
      },
    },
    signal(name: string) {
      this.signals.push(name);
    },
    close() {
      this.closed = true;
    },
    emit(event: string, ...args: unknown[]) {
      for (const cb of listeners[event] ?? []) cb(...args);
    },
    emitStderr(data: Buffer) {
      for (const cb of stderrListeners) cb(data);
    },
  };
}

describe("collectExec", () => {
  test("resolves with collected output on close", async () => {
    const stream = fakeStream();
    const pending = collectExec(stream);
    stream.emit("data", Buffer.from("out"));
    stream.emitStderr(Buffer.from("err"));
    stream.emit("close", 0);
    expect(await pending).toEqual({
      stdout: "out",
      stderr: "err",
      exitCode: 0,
    });
  });

  test("times out, kills the remote process, and keeps partial output", async () => {
    const stream = fakeStream();
    const pending = collectExec(stream, { timeoutMs: 10 });
    stream.emit("data", Buffer.from("partial"));
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CommandTimeoutError);
    expect((err as CommandTimeoutError).stdout).toBe("partial");
    expect(stream.signals).toContain("KILL");
    expect(stream.closed).toBe(true);
  });

  test("rejects immediately when the signal is already aborted", async () => {
    const stream = fakeStream();
    const err = await collectExec(stream, {
      signal: AbortSignal.abort("stop"),
    }).catch((e: unknown) => e);
    expect(err).toBe("stop");
    expect(stream.closed).toBe(true);
  });

  test("rejects with the abort reason on mid-flight abort", async () => {
    const stream = fakeStream();
    const controller = new AbortController();
    const pending = collectExec(stream, { signal: controller.signal });
    controller.abort(new Error("cancelled"));
    const err = await pending.catch((e: unknown) => e);
    expect((err as Error).message).toBe("cancelled");
    expect(stream.signals).toContain("KILL");
  });

  test("streams chunks to onData as they arrive", async () => {
    const stream = fakeStream();
    const chunks: Array<{ stream: string; data: string }> = [];
    const pending = collectExec(stream, { onData: (c) => chunks.push(c) });
    stream.emit("data", Buffer.from("out"));
    stream.emitStderr(Buffer.from("err"));
    stream.emit("close", 0);
    await pending;
    expect(chunks).toEqual([
      { stream: "stdout", data: "out" },
      { stream: "stderr", data: "err" },
    ]);
  });
});

describe("fileEntryFromAttrs", () => {
  const attrs = (mode: number, kind: "dir" | "link" | "file" | "other") => ({
    size: 42,
    mode,
    isDirectory: () => kind === "dir",
    isSymbolicLink: () => kind === "link",
    isFile: () => kind === "file",
  });

  test("classifies entries and masks the mode to permission bits", () => {
    expect(fileEntryFromAttrs("src", attrs(0o40755, "dir"))).toEqual({
      name: "src",
      type: "directory",
      size: 42,
      mode: 0o755,
    });
    expect(fileEntryFromAttrs("a.txt", attrs(0o100644, "file"))).toEqual({
      name: "a.txt",
      type: "file",
      size: 42,
      mode: 0o644,
    });
    expect(fileEntryFromAttrs("ln", attrs(0o120777, "link")).type).toBe(
      "symlink",
    );
    expect(fileEntryFromAttrs("sock", attrs(0o140644, "other")).type).toBe(
      "other",
    );
  });
});

describe("disposal", () => {
  const handle = {
    appId: "app-1",
    name: "s",
    agentToken: "t",
    sshHost: "1.2.3.4:8023",
  };

  test("await using disconnects without deleting the sandbox", async () => {
    let disconnected = false;
    {
      await using sandbox = Sandbox.fromHandle(handle);
      sandbox.disconnect = () => {
        disconnected = true;
      };
    }
    expect(disconnected).toBe(true);
  });

  test("using disconnects synchronously", () => {
    let disconnected = false;
    {
      using sandbox = Sandbox.fromHandle(handle);
      sandbox.disconnect = () => {
        disconnected = true;
      };
    }
    expect(disconnected).toBe(true);
  });
});

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
        endpoints: [
          { type: "anycast", publicHost: "1.2.3.4:8023" },
          {
            type: "cdn",
            publicHost: "app-3000.b-cdn.net",
            portMappings: [{ containerPort: 3000 }],
          },
          {
            type: "cdn",
            publicHost: "app-8080.b-cdn.net",
            portMappings: [{ containerPort: 8080 }],
          },
          { type: "cdn", portMappings: [{ containerPort: 9999 }] },
        ],
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
  test("maps CDN-exposed ports to their public hosts", () => {
    expect(extractCdnPorts(app)).toEqual({
      3000: "app-3000.b-cdn.net",
      8080: "app-8080.b-cdn.net",
    });
  });
  test("skips CDN endpoints whose public host is still provisioning", () => {
    expect(extractCdnPorts(app)[9999]).toBeUndefined();
  });
  test("returns null when fields are absent", () => {
    expect(extractAnycastHost({})).toBeNull();
    expect(extractAgentToken({})).toBeNull();
    expect(firstContainerId({})).toBeNull();
    expect(extractCdnPorts({})).toEqual({});
  });
});
