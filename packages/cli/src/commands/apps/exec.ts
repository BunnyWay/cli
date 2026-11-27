import { defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { isInteractive, prompts, spinner } from "@/core/ui.ts";
import {
  type AppSummary,
  appsExec,
  appsList,
  appsPodsList,
  type ExecSession,
  findContainer,
  findPod,
  type Pod,
  type PodContainer,
} from "@/tools/apps/index.ts";
import type { ToolContext } from "@/tools/context.ts";
import { findLinkedAppId } from "./config.ts";
import { assertTypeable, runExecCommand } from "./exec-command.ts";
import { runExecSession } from "./exec-session.ts";

/** Close codes that end a session normally; 1006 is included because exiting the shell can't be told apart from a network drop. */
export function endedNormally(code: number): boolean {
  return code === 1000 || code === 1005 || code === 1006;
}

interface ExecArgs {
  id?: string;
  /** The command after a `--` separator, populated by yargs. */
  "--"?: string[];
  pod?: string;
  container?: string;
}

// Ready pods first, so the default choice is one that can take a shell.
function byReadiness(a: Pod, b: Pod): number {
  return Number(b.status === "ready") - Number(a.status === "ready");
}

// With JSON output a prompt would land on stdout ahead of the result, and unattended there's nobody to answer it.
function choiceNeeded(what: "pod" | "container", options: string[]): UserError {
  return new UserError(
    `Pass --${what}: there's more than one to choose from.`,
    `Choose one of: ${options.join(", ")}.`,
  );
}

/** The app to open a shell in: --id, then the linked app, then a prompt listing the account's apps. */
export async function resolveApp(
  ctx: ToolContext,
  explicit: string | undefined,
  interactive: boolean,
): Promise<string> {
  if (explicit) return explicit;
  const linked = findLinkedAppId();
  if (linked) return linked;

  if (!interactive) {
    throw new UserError(
      "No linked app.",
      "Pass --id <app-id>, or run `bunny apps link` to link this directory.",
    );
  }

  const spin = spinner("Fetching apps...");
  spin.start();
  let apps: AppSummary[];
  try {
    apps = await appsList.invoke(ctx, {});
  } finally {
    spin.stop();
  }

  if (apps.length === 0) {
    throw new UserError(
      "No apps found on this account.",
      "Deploy one with `bunny apps deploy`.",
    );
  }

  const { id } = await prompts({
    type: "select",
    name: "id",
    message: "App:",
    choices: apps.map((app) => ({
      title: app.name,
      description: [app.id, app.status].filter(Boolean).join(" · "),
      value: app.id,
    })),
  });
  if (id === undefined) throw new UserError("An app is required.");
  logger.dim(`Tip: run \`bunny apps link ${id}\` to skip this next time.`);
  return id;
}

async function pickPod(
  pods: Pod[],
  appId: string,
  interactive: boolean,
): Promise<Pod> {
  if (pods.length === 0) {
    throw new UserError(
      `App ${appId} has no running instances.`,
      "Deploy it with `bunny apps deploy`, or check `bunny apps show`.",
    );
  }
  if (pods.length === 1) {
    const [only] = pods as [Pod];
    logger.dim(`Pod: ${only.name}`);
    return only;
  }
  if (!interactive)
    throw choiceNeeded(
      "pod",
      pods.map((p) => p.name),
    );

  const { name } = await prompts({
    type: "select",
    name: "name",
    message: "Pod:",
    choices: [...pods].sort(byReadiness).map((pod) => ({
      title: pod.name,
      description: [pod.region, pod.status].filter(Boolean).join(" · "),
      value: pod.name,
    })),
  });
  if (name === undefined) throw new UserError("A pod is required.");
  return findPod(pods, appId, name);
}

async function pickContainer(
  pod: Pod,
  interactive: boolean,
): Promise<PodContainer> {
  if (pod.containers.length === 0) {
    throw new UserError(`Pod ${pod.name} has no containers.`);
  }
  if (pod.containers.length === 1) {
    const [only] = pod.containers as [PodContainer];
    logger.dim(`Container: ${only.name}`);
    return only;
  }
  if (!interactive) {
    throw choiceNeeded(
      "container",
      pod.containers.map((c) => c.name),
    );
  }

  const { id } = await prompts({
    type: "select",
    name: "id",
    message: "Container:",
    choices: pod.containers.map((container) => ({
      title: container.name,
      description: container.status,
      value: container.id,
    })),
  });
  if (id === undefined) throw new UserError("A container is required.");
  return findContainer(pod, id);
}

/** Fill in whichever of pod and container wasn't passed: the only one when there's one, otherwise a prompt, or an error when it can't prompt. */
export async function resolveTarget(
  ctx: ToolContext,
  appId: string,
  args: Pick<ExecArgs, "pod" | "container">,
  interactive: boolean,
): Promise<{ pod: string; container: string }> {
  if (args.pod && args.container) {
    return { pod: args.pod, container: args.container };
  }

  const spin = spinner("Fetching pods...");
  spin.start();
  let pods: Pod[];
  try {
    pods = await appsPodsList.invoke(ctx, { app: appId });
  } finally {
    spin.stop();
  }

  const pod = args.pod
    ? findPod(pods, appId, args.pod)
    : await pickPod(pods, appId, interactive);
  const container = args.container
    ? findContainer(pod, args.container)
    : await pickContainer(pod, interactive);
  return { pod: pod.name, container: container.id };
}

/** Run one command and exit with its status; JSON output collects it and never includes the token. */
async function runCommand(
  session: ExecSession,
  command: string[],
  json: boolean,
): Promise<void> {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);

  let output = "";
  let exitCode: number;
  try {
    exitCode = await runExecCommand(session.url, session.token, command, {
      write: (text) => {
        if (json) output += text;
        else process.stdout.write(text);
      },
      size:
        process.stdout.isTTY && process.stdout.columns && process.stdout.rows
          ? { cols: process.stdout.columns, rows: process.stdout.rows }
          : undefined,
      signal: controller.signal,
    });
  } finally {
    process.off("SIGINT", interrupt);
  }

  if (json) {
    logger.log(
      JSON.stringify(
        {
          app: session.app,
          pod: session.pod,
          container: session.container,
          command,
          exitCode,
          output,
        },
        null,
        2,
      ),
    );
  }
  process.exitCode = exitCode;
}

export const appsExecCommand = defineToolCommand({
  tool: appsExec,
  command: "exec",
  describe:
    "Open an interactive shell in a running container, or run one command with `-- <command>`.",
  progress: "Starting exec session...",
  examples: [
    ["$0 apps exec", "Pick a pod and container, then open a shell"],
    [
      "$0 apps exec --pod <pod> --container api",
      "Open a shell in the api container of one pod",
    ],
    ["$0 apps exec -- whoami", "Run one command and print its output"],
    [
      "$0 apps exec --container api -- sh -c 'ls /app | head'",
      "Run a pipeline through the container's shell",
    ],
    [
      "$0 apps exec --pod <pod> --container api --output json",
      "Print the session's WebSocket URL instead of connecting",
    ],
  ],

  builder: (yargs) =>
    yargs
      .parserConfiguration({ "populate--": true })
      .option("id", {
        type: "string",
        describe: "App ID (defaults to the linked app; prompts when none)",
      })
      .option("pod", {
        type: "string",
        describe: "Pod (instance) name; prompts when left out",
      })
      .option("container", {
        type: "string",
        describe: "Container name or ID; prompts when left out",
      }),

  // Checked before any API call, so a piped run fails fast instead of starting a session nobody can type into.
  preRun: async (args: ExecArgs & { output?: string }) => {
    const command = args["--"];
    if (command) {
      assertTypeable(command);
      return;
    }
    // Both ends must be a terminal: `apps exec | tee log` would otherwise write escape codes into the log.
    if (
      args.output !== "json" &&
      !(process.stdin.isTTY && process.stdout.isTTY)
    ) {
      throw new UserError(
        "apps exec needs an interactive terminal.",
        "Run one command with `bunny apps exec -- <command>`, or pass --output json to get the session URL for another client.",
      );
    }
  },

  prepare: async (args: ExecArgs & { output?: string }, ctx) => {
    const interactive = isInteractive(args.output);
    const app = await resolveApp(ctx, args.id, interactive);
    const target = await resolveTarget(ctx, app, args, interactive);
    return { input: { app, ...target } };
  },

  after: async (session, args: ExecArgs & { output?: string }) => {
    const command = args["--"];
    if (command) {
      await runCommand(session, command, args.output === "json");
      return;
    }
    if (args.output === "json") return;

    const spin = spinner("Connecting...");
    spin.start();
    let end: Awaited<ReturnType<typeof runExecSession>>;
    try {
      end = await runExecSession(session.url, session.token, {
        onOpen: () => {
          spin.stop();
          logger.dim(
            `Connected to ${session.container.name} in ${session.pod}. Press Ctrl-] to disconnect.`,
          );
        },
      });
    } finally {
      spin.stop();
    }

    if (end.detached) logger.dim("\nDisconnected.");
    else if (endedNormally(end.code)) {
      logger.dim("Session ended.");
    } else {
      // Only error closes like 1008 fail; a dropped connection (1006) already counted as a normal end above.
      throw new UserError(
        `Session closed unexpectedly (${end.code}${end.reason ? `: ${end.reason}` : ""}).`,
        "Run the command again to reconnect.",
      );
    }
  },

  // The session or command already printed; only a bare session prints itself as JSON.
  emit: (_session, args: ExecArgs & { output?: string }) =>
    Boolean(args["--"]) || args.output !== "json",
  render: () => {},
});
