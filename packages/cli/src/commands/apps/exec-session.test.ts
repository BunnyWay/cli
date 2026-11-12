import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Server, ServerWebSocket } from "bun";
import {
  DETACH_BYTE,
  runExecSession,
  type TerminalInput,
  type TerminalOutput,
} from "./exec-session.ts";

// Plain emitters stand in for stdin/stdout: no pty is involved.
class FakeInput extends EventEmitter implements TerminalInput {
  isTTY = true;
  raw: boolean[] = [];
  paused = true;
  setRawMode(mode: boolean) {
    this.raw.push(mode);
  }
  resume() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  type(bytes: string | number[]) {
    this.emit(
      "data",
      typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes),
    );
  }
}

class FakeOutput extends EventEmitter implements TerminalOutput {
  columns = 120;
  rows = 40;
  written: string[] = [];
  write(data: string | Uint8Array) {
    this.written.push(
      typeof data === "string" ? data : Buffer.from(data).toString(),
    );
  }
}

interface Received {
  text: string[];
  binary: string[];
}

let server: Server<undefined> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

// A stand-in for the exec endpoint: records what the client sends and lets the test drive the server side.
function startServer(onOpen: (ws: ServerWebSocket<undefined>) => void) {
  const received: Received = { text: [], binary: [] };
  let notify = () => {};
  const changed = () =>
    new Promise<void>((resolve) => {
      notify = resolve;
    });
  server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      return srv.upgrade(req) ? undefined : new Response("no", { status: 400 });
    },
    websocket: {
      open: onOpen,
      message(_ws, message) {
        if (typeof message === "string") received.text.push(message);
        else received.binary.push(Buffer.from(message).toString());
        notify();
      },
    },
  });
  return { url: `ws://localhost:${server.port}`, received, changed };
}

async function until(check: () => boolean, changed: () => Promise<void>) {
  while (!check()) await changed();
}

test("bridges keystrokes, output, and resizes until the server closes", async () => {
  const stdin = new FakeInput();
  const stdout = new FakeOutput();
  let socket: ServerWebSocket<undefined> | undefined;
  const { url, received, changed } = startServer((ws) => {
    socket = ws;
    ws.send(new TextEncoder().encode("$ "));
  });
  let opened = false;

  const session = runExecSession(url, {
    stdin,
    stdout,
    onOpen: () => {
      opened = true;
    },
  });

  await until(() => received.text.length === 1, changed);
  expect(opened).toBe(true);
  expect(stdin.raw).toEqual([true]);
  expect(JSON.parse(received.text[0] ?? "")).toEqual({
    type: "resize",
    cols: 120,
    rows: 40,
  });

  stdin.type("ls\r");
  await until(() => received.binary.length === 1, changed);
  expect(received.binary).toEqual(["ls\r"]);

  stdout.columns = 80;
  stdout.rows = 24;
  stdout.emit("resize");
  await until(() => received.text.length === 2, changed);
  expect(JSON.parse(received.text[1] ?? "")).toMatchObject({
    cols: 80,
    rows: 24,
  });

  socket?.send("file.txt\r\n");
  socket?.close(1000, "exit");
  const end = await session;

  expect(stdout.written.join("")).toBe("$ file.txt\r\n");
  expect(end).toEqual({ code: 1000, reason: "exit", detached: false });
  // The terminal is handed back: raw mode off, input released.
  expect(stdin.raw).toEqual([true, false]);
  expect(stdin.paused).toBe(true);
  expect(stdin.listenerCount("data")).toBe(0);
  expect(stdout.listenerCount("resize")).toBe(0);
});

test("Ctrl-] sends what came before it, then disconnects", async () => {
  const stdin = new FakeInput();
  const stdout = new FakeOutput();
  const { url, received, changed } = startServer(() => {});

  const session = runExecSession(url, { stdin, stdout });
  await until(() => received.text.length === 1, changed);

  stdin.type([...Buffer.from("top"), DETACH_BYTE, ...Buffer.from("after")]);
  const end = await session;

  expect(end.detached).toBe(true);
  // Detach settles without waiting on the server, so the bytes before Ctrl-] may still be in flight.
  await until(() => received.binary.length === 1, changed);
  expect(received.binary).toEqual(["top"]);
  expect(stdin.raw).toEqual([true, false]);
});

test("Ctrl-C is forwarded as a byte, not handled locally", async () => {
  const stdin = new FakeInput();
  const stdout = new FakeOutput();
  let socket: ServerWebSocket<undefined> | undefined;
  const { url, received, changed } = startServer((ws) => {
    socket = ws;
  });

  const session = runExecSession(url, { stdin, stdout });
  await until(() => received.text.length === 1, changed);
  stdin.type([0x03]);
  await until(() => received.binary.length === 1, changed);
  expect(received.binary).toEqual(["\x03"]);

  socket?.close(1000);
  await session;
});

test("skips raw mode and resizes when not attached to a terminal", async () => {
  const stdin = new FakeInput();
  stdin.isTTY = false;
  const stdout = new FakeOutput();
  stdout.columns = 0;
  let socket: ServerWebSocket<undefined> | undefined;
  const { url, received, changed } = startServer((ws) => {
    socket = ws;
  });

  const session = runExecSession(url, { stdin, stdout });
  // No resize frame announces the open socket, so wait for the input listener instead.
  while (stdin.listenerCount("data") === 0) await Bun.sleep(5);
  stdin.type("echo hi\n");
  await until(() => received.binary.length === 1, changed);
  socket?.close(1000);
  await session;

  expect(stdin.raw).toEqual([]);
  expect(received.text).toEqual([]);
});

test("rejects when the socket can't be opened", async () => {
  const stdin = new FakeInput();
  const stdout = new FakeOutput();
  server = Bun.serve({
    port: 0,
    fetch: () => new Response("gone", { status: 410 }),
  });

  await expect(
    runExecSession(`ws://localhost:${server.port}`, { stdin, stdout }),
  ).rejects.toThrow("Couldn't connect to the exec session.");
  expect(stdin.raw).toEqual([]);
});

// Completes the WebSocket handshake (or not), then ignores everything, close frames included.
function silentPeer(handshake: boolean) {
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(sock, buf) {
        const key = /Sec-WebSocket-Key: (.+)\r\n/i.exec(buf.toString())?.[1];
        if (!key || !handshake) return;
        const accept = createHash("sha1")
          .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest("base64");
        sock.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
      },
    },
  });
  return {
    url: `ws://127.0.0.1:${listener.port}`,
    stop: () => listener.stop(true),
  };
}

test("Ctrl-] returns at once even when the remote never acknowledges", async () => {
  const peer = silentPeer(true);
  const stdin = new FakeInput();
  const stdout = new FakeOutput();
  try {
    const session = runExecSession(peer.url, {
      stdin,
      stdout,
      closeGraceMs: 10,
    });
    while (stdin.listenerCount("data") === 0) await Bun.sleep(5);

    stdin.type([DETACH_BYTE]);
    const end = await session;

    expect(end.detached).toBe(true);
    expect(stdin.raw).toEqual([true, false]);
    expect(stdin.listenerCount("data")).toBe(0);
  } finally {
    peer.stop();
  }
});

test("gives up when the socket never opens", async () => {
  const peer = silentPeer(false);
  const stdin = new FakeInput();
  try {
    await expect(
      runExecSession(peer.url, {
        stdin,
        stdout: new FakeOutput(),
        connectTimeoutMs: 50,
      }),
    ).rejects.toThrow("Timed out connecting to the exec session.");
    expect(stdin.raw).toEqual([]);
  } finally {
    peer.stop();
  }
});
