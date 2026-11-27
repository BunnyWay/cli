import { afterEach, expect, test } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import {
  assertTypeable,
  commandLine,
  MAX_LINE_BYTES,
  MarkedOutput,
  runExecCommand,
} from "./exec-command.ts";

const RS = "\x1e";

test("the typed line quotes arguments and spells markers as escapes, so its echo never matches them", () => {
  const line = commandLine(["echo", "a b", "it's"], "n1");
  expect(line).toBe(
    `printf '\\036Bn1\\036'; echo 'a b' 'it'\\''s'; printf '\\036En1:%d\\036' $?; exit\r`,
  );
  expect(line).not.toContain(RS);
});

test("refuses commands a shell can't take as one typed line", () => {
  expect(() => assertTypeable(["sh", "-c", "echo ok"])).not.toThrow();
  expect(() => assertTypeable(["sh", "-c", "echo a\necho b"])).toThrow(
    "control character",
  );
  expect(() => assertTypeable(["printf", "\x03"])).toThrow("control character");
  expect(() => assertTypeable(["echo", "x".repeat(MAX_LINE_BYTES)])).toThrow(
    "too long",
  );
});

test("keeps only what's between the markers, and reads the exit code", () => {
  const out = new MarkedOutput("n");
  const echo = commandLine(["ls"], "n");
  expect(out.feed(`/ # ${echo}\r\n`)).toBe("");
  expect(out.feed(`${RS}Bn${RS}a.txt\r\nb.txt\r\n`)).toBe("a.txt\nb.txt\n");
  expect(out.exitCode).toBeUndefined();
  expect(out.feed(`${RS}En:2${RS}/ # exit`)).toBe("");
  expect(out.exitCode).toBe(2);
  expect(out.feed("more")).toBe("");
});

test("finds markers split across chunks", () => {
  const out = new MarkedOutput("abc");
  const stream = `prompt ${RS}Babc${RS}hello\r\n${RS}Eabc:17${RS}`;
  let printed = "";
  for (const char of stream) printed += out.feed(char);
  expect(printed).toBe("hello\n");
  expect(out.exitCode).toBe(17);
});

test("passes through a record separator that isn't a marker", () => {
  const out = new MarkedOutput("n");
  out.feed(`${RS}Bn${RS}`);
  expect(out.feed(`x${RS}y`)).toBe(`x${RS}y`);
});

let server: Server<undefined> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

// Acts like the exec endpoint's shell: echoes the typed line, then answers with the marked output.
function fakeShell(
  reply: (ws: ServerWebSocket<undefined>) => void,
  onText?: (ws: ServerWebSocket<undefined>, text: string) => void,
) {
  const received: string[] = [];
  server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      return srv.upgrade(req) ? undefined : new Response("no", { status: 400 });
    },
    websocket: {
      message(ws, message) {
        if (typeof message === "string") {
          received.push(message);
          onText?.(ws, message);
          return;
        }
        const line = Buffer.from(message).toString();
        received.push(line);
        ws.send(new TextEncoder().encode(`/ # ${line}\r\n`));
        reply(ws);
      },
    },
  });
  return { url: `ws://localhost:${server.port}`, received };
}

test("sends the token first, runs the command, and resolves with its exit code", async () => {
  const { url, received } = fakeShell((ws) => {
    ws.send(new TextEncoder().encode(`${RS}Bn${RS}root\r\n`));
    ws.send(new TextEncoder().encode(`${RS}En:4${RS}`));
  });
  let output = "";

  const code = await runExecCommand(url, "tok", ["whoami"], {
    write: (text) => {
      output += text;
    },
    size: { cols: 100, rows: 30 },
    nonce: "n",
  });

  expect(code).toBe(4);
  expect(output).toBe("root\n");
  expect(received[0]).toBe("tok");
  expect(JSON.parse(received[1] ?? "")).toEqual({
    type: "resize",
    cols: 100,
    rows: 30,
  });
  expect(received[2]).toBe(commandLine(["whoami"], "n"));
});

test("fails when the session closes before the command reports back", async () => {
  const { url } = fakeShell((ws) => {
    ws.send(new TextEncoder().encode(`${RS}Bn${RS}partial`));
    ws.close(1000, "exec ended");
  });
  let output = "";

  await expect(
    runExecCommand(url, "tok", ["exit"], {
      write: (text) => {
        output += text;
      },
      nonce: "n",
    }),
  ).rejects.toThrow("The session closed before the command finished.");
  expect(output).toBe("partial");
});

test("aborting sends Ctrl-C, prints what still arrives, and resolves with 130", async () => {
  const controller = new AbortController();
  const { url, received } = fakeShell(
    (ws) => ws.send(new TextEncoder().encode(`${RS}Bn${RS}tick\r\n`)),
    (ws, text) => {
      if (text === "\x03") ws.send(new TextEncoder().encode("late\r\n"));
    },
  );
  let output = "";

  const code = await runExecCommand(url, "tok", ["sleep", "100"], {
    write: (text) => {
      output += text;
      controller.abort();
    },
    signal: controller.signal,
    abortGraceMs: 100,
    nonce: "n",
  });

  expect(code).toBe(130);
  expect(received).toContain("\x03");
  expect(output).toBe("tick\nlate\n");
});

test("gives up when the shell never starts the command", async () => {
  const { url } = fakeShell(() => {});
  await expect(
    runExecCommand(url, "tok", ["whoami"], {
      write: () => {},
      startTimeoutMs: 50,
      nonce: "n",
    }),
  ).rejects.toThrow("The container's shell didn't start the command.");
});

test("aborting before the socket opens leaves no session open", async () => {
  const controller = new AbortController();
  let opened = 0;
  let closed = 0;
  server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      return srv.upgrade(req) ? undefined : new Response("no", { status: 400 });
    },
    websocket: {
      open() {
        opened++;
      },
      message() {},
      close() {
        closed++;
      },
    },
  });

  const run = runExecCommand(
    `ws://localhost:${server.port}`,
    "tok",
    ["whoami"],
    { write: () => {}, signal: controller.signal, nonce: "n" },
  );
  controller.abort();

  expect(await run).toBe(130);
  // Give a socket that connected anyway time to open, then require it closed.
  await Bun.sleep(200);
  expect(closed).toBe(opened);
});
