import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as readline from "node:readline";
import type { Client } from "@libsql/client";
import chalk from "chalk";
import { executeDotCommand } from "./dot-commands.ts";
import { printResultSet } from "./format.ts";
import { HISTORY_MAX, loadHistory, saveHistory } from "./history.ts";
import { splitStatements } from "./parser.ts";
import type { ExecuteOptions, ShellLogger, ShellOptions } from "./types.ts";
import { getDefaultViewsDir } from "./views.ts";

const PROMPT = chalk.blue.bold("→  ");
const PROMPT_CONTINUE = chalk.blue.bold("... ");

/** Default logger that writes to console with no styling beyond what chalk provides. */
function defaultLogger(): ShellLogger {
  return {
    log: (msg?: string) => console.log(msg ?? ""),
    error: (msg: string) => console.error(msg),
    warn: (msg: string) => console.warn(msg),
    dim: (msg: string) => console.log(chalk.dim(msg)),
    success: (msg: string) => console.log(`${chalk.green("✓")} ${msg}`),
  };
}

/**
 * Execute a single SQL query against the database and print the result.
 */
export async function executeQuery(
  client: Client,
  sql: string,
  options?: ExecuteOptions,
): Promise<void> {
  const logger = options?.logger ?? defaultLogger();
  const mode = options?.mode ?? "default";
  const masked = options?.masked ?? true;

  const result = await client.execute(sql);
  printResultSet(result, mode, masked, logger);
}

/**
 * Read a `.sql` file, split it into individual statements, and execute them
 * sequentially. Stops on the first error and reports which statement failed.
 */
export async function executeFile(
  client: Client,
  filePath: string,
  options?: ExecuteOptions,
): Promise<void> {
  const logger = options?.logger ?? defaultLogger();
  const mode = options?.mode ?? "default";
  const masked = options?.masked ?? true;
  const timing = options?.timing ?? false;

  const absPath = resolve(filePath);
  if (!existsSync(absPath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = readFileSync(absPath, "utf-8");
  const statements = splitStatements(content);
  if (statements.length === 0) {
    logger.warn("No SQL statements found in file.");
    return;
  }
  logger.dim(
    `  Executing ${statements.length} statement${statements.length === 1 ? "" : "s"} from ${filePath}`,
  );

  try {
    const t0 = performance.now();
    const results = await client.batch(statements);
    const elapsed = performance.now() - t0;
    for (const result of results) {
      printResultSet(result, mode, masked, logger);
    }
    if (timing) {
      logger.log(chalk.dim(`  ${elapsed.toFixed(1)}ms`));
    }
  } catch (err: any) {
    logger.error(`${err.message}`);
    return;
  }
  logger.success(
    `${statements.length} statement${statements.length === 1 ? "" : "s"} executed.`,
  );
}

/**
 * Start an interactive SQL shell session.
 *
 * Provides a readline-based REPL with:
 * - Multi-line SQL support (accumulates lines until `;` terminator)
 * - Dot-commands (`.tables`, `.schema`, `.dump`, etc.)
 * - Persistent history
 * - Sensitive column masking
 * - Multiple output modes (default, table, json, csv, markdown)
 * - Query timing
 *
 * Requires a TTY. Resolves when the user exits (`.quit` or Ctrl+D).
 */
export async function startShell(options: ShellOptions): Promise<void> {
  const { client } = options;
  const logger = options.logger ?? defaultLogger();

  if (!process.stdin.isTTY) {
    throw new Error("Interactive shell requires a TTY.");
  }

  const viewsDir =
    options.viewsDir ??
    (options.databaseId ? getDefaultViewsDir(options.databaseId) : null);

  const state = {
    mode: options.mode ?? "default",
    masked: options.masked ?? true,
    timing: options.timing ?? false,
    lastStatement: null as string | null,
    viewsDir,
  };
  const history = loadHistory();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: PROMPT,
    terminal: true,
    history,
    historySize: HISTORY_MAX,
  });

  logger.log();
  logger.log(`${chalk.green("✓")} Connected to database`);
  logger.dim("  Type .help for commands, .quit to exit.");
  logger.log();
  rl.prompt();

  let buffer: string[] = [];

  // Serialize async line handling so pasted multi-statement blocks execute in order.
  let queue: Promise<void> = Promise.resolve();

  rl.on("line", (line: string) => {
    queue = queue.then(() => handleLine(line));
  });

  async function handleLine(line: string): Promise<void> {
    const trimmed = line.trim();

    // Empty line
    if (trimmed.length === 0 && buffer.length === 0) {
      rl.prompt();
      return;
    }

    // Dot-command (only when not in a multi-line statement)
    if (buffer.length === 0 && trimmed.startsWith(".")) {
      try {
        logger.log();
        const result = await executeDotCommand(
          trimmed,
          client,
          state,
          rl,
          logger,
        );
        if (result === "quit") {
          rl.close();
          return;
        }
        if (result === "unknown") {
          logger.error(`Unknown command: ${trimmed.split(/\s/)[0]}`);
          logger.dim('  Type ".help" for available commands.');
        }
      } catch (err: any) {
        logger.error(err.message);
      }
      logger.log();
      rl.prompt();
      return;
    }

    // Accumulate SQL
    buffer.push(line);
    const statement = buffer.join("\n").trim();

    if (!statement.endsWith(";")) {
      rl.setPrompt(PROMPT_CONTINUE);
      rl.prompt();
      return;
    }

    // Execute complete statement
    buffer = [];
    rl.setPrompt(PROMPT);

    try {
      logger.log();
      const t0 = performance.now();
      const result = await client.execute(statement);
      const elapsed = performance.now() - t0;
      state.lastStatement = statement;
      printResultSet(result, state.mode, state.masked, logger);
      if (state.timing) {
        logger.log(chalk.dim(`  ${elapsed.toFixed(1)}ms`));
      }
    } catch (err: any) {
      logger.log();
      logger.error(err.message);
    }

    logger.log();
    rl.prompt();
  }

  rl.on("SIGINT", () => {
    if (buffer.length > 0) {
      buffer = [];
      logger.log();
      rl.setPrompt(PROMPT);
      rl.prompt();
    } else {
      rl.close();
    }
  });

  rl.on("close", () => {
    saveHistory((rl as any).history ?? []);
    logger.log();
  });

  // Keep the process alive while the REPL is running
  await new Promise<void>((resolve) => {
    rl.on("close", resolve);
  });
}
