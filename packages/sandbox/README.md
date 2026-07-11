# @bunny.net/sandbox

Programmatically create bunny.net sandboxes, buffer files into them, run commands, and expose ports. Backed by Magic Containers, with a code-first developer experience.

## Install

```bash
bun add @bunny.net/sandbox
```

## Quick start

```ts
import { Sandbox } from "@bunny.net/sandbox";

// Provision a sandbox and wait until it accepts connections.
const sandbox = await Sandbox.create({
  apiKey: process.env.BUNNYNET_API_KEY,
  name: "my-sandbox",
  region: "AMS",
});

// Buffer a file into the sandbox.
await sandbox.writeFiles([{ path: "server.js", content: Buffer.from("console.log('hi')") }]);

// Run a command and read the result.
const result = await sandbox.runCommand("node", ["--version"]);
console.log(result.exitCode, await result.stdout());

// Expose a port as a public CDN URL.
const url = await sandbox.exposePort(3000);
console.log(url);

await sandbox.delete();
```

Authentication comes from the `apiKey` option or the `BUNNYNET_API_KEY` environment variable.

## Long-running commands

Pass `detached: true` to start a process and stream its output:

```ts
const server = await sandbox.runCommand({
  cmd: "node",
  args: ["server.js"],
  detached: true,
});

for await (const { stream, data } of server.logs()) {
  process[stream].write(data);
}

const finished = await server.wait();
console.log(finished.exitCode);
```

## Timeouts and cancellation

Blocking commands accept a `timeout` in milliseconds and an `AbortSignal`. On timeout the remote process is killed and the call rejects with `CommandTimeoutError`, which carries the output collected so far:

```ts
import { CommandTimeoutError } from "@bunny.net/sandbox";

try {
  await sandbox.runCommand({ cmd: "bun", args: ["run", "build"], timeout: 30_000 });
} catch (err) {
  if (err instanceof CommandTimeoutError) console.log(err.stdout, err.stderr);
}

// Or cancel from an AbortSignal; the call rejects with the abort reason.
const controller = new AbortController();
const pending = sandbox.runCommand({ cmd: "sleep", args: ["600"], signal: controller.signal });
controller.abort();
```

Detached commands manage their own lifetime instead: use `command.kill()`.

## Reconnecting

`Sandbox.create` returns a handle you can persist and rebuild later, with no API round trip:

```ts
const handle = sandbox.toHandle();
// ...store handle somewhere...

const same = Sandbox.fromHandle(handle, { apiKey });
```

Or look a sandbox up by its app ID, recovering its connection details from the API:

```ts
const sandbox = await Sandbox.get({ apiKey, appId });
```

## API

| Method                                        | Description                                               |
| --------------------------------------------- | --------------------------------------------------------- |
| `Sandbox.create(options)`                     | Provision a sandbox and wait until SSH is reachable.      |
| `Sandbox.get({ appId })`                      | Retrieve an existing sandbox by app ID.                   |
| `Sandbox.fromHandle(handle)`                  | Rebuild a sandbox from a serialized handle.               |
| `sandbox.runCommand(cmd, args)`               | Run a command, blocking for the result.                   |
| `sandbox.runCommand({ ..., detached: true })` | Start a command and stream `logs()`.                      |
| `sandbox.writeFiles(files)`                   | Upload files, creating parent directories.                |
| `sandbox.readFile(path)`                      | Read a file into a Buffer, or `null` if missing.          |
| `sandbox.listFiles(path?)`                    | List directory entries; `[]` if the directory is missing. |
| `sandbox.deleteFile(path)`                    | Delete a file; `false` if it did not exist.               |
| `sandbox.rename(from, to)`                    | Rename or move; fails if the destination exists.          |
| `sandbox.exists(path)`                        | Whether a file or directory exists.                       |
| `sandbox.mkDir(path)`                         | Create a directory.                                       |
| `sandbox.exposePort(port, label?)`            | Expose a port as a public CDN URL.                        |
| `sandbox.domain(port)`                        | Return the URL of an already exposed port.                |
| `sandbox.delete()`                            | Delete the sandbox and its backing app.                   |
| `sandbox.toHandle()`                          | Serialize the sandbox for reconnection.                   |

## Not yet supported

Magic Containers has no equivalent for these features, so they are intentionally omitted: `stop()`/resume, automatic timeouts, and snapshot/fork. Volumes persist across the sandbox lifetime, but there is no snapshot or branch API.

## Transport

Commands and file transfers run over SSH/SFTP (pure-JS [`ssh2`](https://github.com/mscdex/ssh2), no `sshpass` binary). The agent token generated at creation is used as the root password, and the connection targets the anycast SSH endpoint provisioned on the app.
