import { defineCommand } from "@/core/define-command.ts";
import { UserError } from "@/core/errors.ts";
import { logger } from "@/core/logger.ts";
import {
  aiFetch,
  DEFAULT_MODEL,
  MODEL_ENV,
  sseFrames,
  toNetworkError,
} from "./api.ts";

const COMMAND = "text [prompt..]";
const DESCRIPTION = "Generate text from a prompt.";

interface TextArgs {
  prompt?: string[];
  model?: string;
  system?: string;
  "max-tokens"?: number;
  temperature?: number;
  timeout: number;
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
}

interface Completion {
  model?: string;
  choices?: {
    message?: { content?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: Usage;
}

interface CompletionChunk {
  model?: string;
  choices?: {
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: Usage;
  error?: string | { message?: string };
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8").trim();
}

function write(data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(data, (err) => (err ? reject(err) : resolve()));
  });
}

function describeUsage(model: string | undefined, usage?: Usage): string {
  const cost = usage?.cost === undefined ? "" : `, $${usage.cost.toFixed(6)}`;
  return `${model ?? "unknown model"}: ${usage?.prompt_tokens ?? 0} in, ${usage?.completion_tokens ?? 0} out${cost}`;
}

/**
 * Generate text from a prompt, streaming the answer to stdout.
 *
 * Piped stdin is appended to the prompt, so a file or another command's
 * output can be the subject of the instruction.
 *
 * @example
 * ```bash
 * bunny ai text "Explain DNS in one sentence"
 * git diff | bunny ai text "Write a commit message for this diff"
 * bunny ai text "Name three colours" --model anthropic/claude-haiku-4-5 --output json
 * ```
 */
export const aiTextCommand = defineCommand<TextArgs>({
  command: COMMAND,
  describe: DESCRIPTION,
  examples: [
    ['$0 ai text "Explain DNS in one sentence"', "Answer a prompt"],
    [
      'git diff | $0 ai text "Write a commit message"',
      "Use piped input as context",
    ],
  ],

  builder: (yargs) =>
    yargs
      .positional("prompt", {
        type: "string",
        array: true,
        describe: "The prompt; piped stdin is appended to it",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: `Model to use (default: ${MODEL_ENV} or ${DEFAULT_MODEL})`,
      })
      .option("system", {
        alias: "s",
        type: "string",
        describe: "System prompt",
      })
      .option("max-tokens", {
        type: "number",
        describe: "Maximum number of tokens to generate",
      })
      .option("temperature", {
        alias: "t",
        type: "number",
        describe: "Sampling temperature",
      })
      .option("timeout", {
        type: "number",
        default: 120,
        describe: "Request timeout in seconds",
      }),

  handler: async ({
    prompt,
    model,
    system,
    "max-tokens": maxTokens,
    temperature,
    timeout,
    output,
    verbose,
  }) => {
    const content = [(prompt ?? []).join(" "), await readStdin()]
      .filter(Boolean)
      .join("\n\n");
    if (!content) {
      throw new UserError(
        "A prompt is required.",
        'Example: bunny ai text "Explain DNS in one sentence"',
      );
    }

    if (!(timeout > 0)) {
      throw new UserError("--timeout must be a positive number of seconds.");
    }

    const stream = output !== "json";
    const res = await aiFetch(
      "/v1/chat/completions",
      verbose,
      {
        model: model ?? process.env[MODEL_ENV] ?? DEFAULT_MODEL,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content },
        ],
        ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
        ...(temperature === undefined ? {} : { temperature }),
        stream,
      },
      timeout,
    );

    if (!stream) {
      const body = (await res.json().catch((err) => {
        throw toNetworkError(err);
      })) as Completion;
      const choice = body.choices?.[0];
      await write(
        `${JSON.stringify(
          {
            text: choice?.message?.content ?? "",
            model: body.model,
            finishReason: choice?.finish_reason ?? null,
            usage: body.usage,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    let served: string | undefined;
    let usage: Usage | undefined;
    let finishReason: string | undefined;
    let last = "\n";
    try {
      for await (const frame of sseFrames<CompletionChunk>(res)) {
        if (frame.error) {
          const message =
            typeof frame.error === "string" ? frame.error : frame.error.message;
          throw new UserError(message ?? "The service reported an error.");
        }
        served = frame.model ?? served;
        usage = frame.usage ?? usage;
        const choice = frame.choices?.[0];
        finishReason = choice?.finish_reason ?? finishReason;
        const delta = choice?.delta?.content;
        if (!delta) continue;
        last = delta;
        await write(delta);
      }
    } finally {
      // Close the partial line so an error message does not run on from the text.
      if (!last.endsWith("\n")) await write("\n");
    }
    if (finishReason === "length") {
      logger.warn("The answer was cut off by the token limit.");
    }
    logger.debug(describeUsage(served, usage), verbose);
  },
});
