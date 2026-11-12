import { defineToolCommand } from "@/core/define-tool-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import { isInteractive, prompts, spinner } from "@/core/ui.ts";
import {
  appsExec,
  appsPodsList,
  findContainer,
  findPod,
  type Pod,
  type PodContainer,
} from "@/tools/apps/index.ts";
import type { ToolContext } from "@/tools/context.ts";
import { resolveAppId } from "./config.ts";
import { runExecSession } from "./exec-session.ts";

interface ExecArgs {
  id?: string;
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

export const appsExecCommand = defineToolCommand({
  tool: appsExec,
  command: "exec",
  describe: "Open an interactive shell in a running container.",
  progress: "Starting exec session...",
  examples: [
    ["$0 apps exec", "Pick a pod and container, then open a shell"],
    [
      "$0 apps exec --pod <pod> --container api",
      "Open a shell in the api container of one pod",
    ],
    [
      "$0 apps exec --pod <pod> --container api --output json",
      "Print the session's WebSocket URL instead of connecting",
    ],
  ],

  builder: (yargs) =>
    yargs
      .option("id", {
        type: "string",
        describe: "App ID (defaults to the linked app)",
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
    if (args.output !== "json" && !process.stdin.isTTY) {
      throw new UserError(
        "apps exec needs an interactive terminal.",
        "Run it from a terminal, or pass --output json to get the session URL for another client.",
      );
    }
  },

  prepare: async (args: ExecArgs & { output?: string }, ctx) => {
    const app = resolveAppId(args.id);
    const target = await resolveTarget(
      ctx,
      app,
      args,
      isInteractive(args.output),
    );
    return { input: { app, ...target } };
  },

  after: async (session, args) => {
    if (args.output === "json") return;

    const spin = spinner("Connecting...");
    spin.start();
    let end: Awaited<ReturnType<typeof runExecSession>>;
    try {
      end = await runExecSession(session.url, {
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
    else if (end.code === 1000 || end.code === 1005) {
      logger.dim("Session ended.");
    } else {
      // A dropped connection is a failure, so scripts and agents don't read it as success.
      throw new UserError(
        `Session closed unexpectedly (${end.code}${end.reason ? `: ${end.reason}` : ""}).`,
        "Run the command again to reconnect.",
      );
    }
  },

  // The session already took over the terminal; only JSON output prints the result.
  emit: (_session, args) => args.output !== "json",
  render: () => {},
});
