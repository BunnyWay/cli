import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatValue,
  formatValueRaw,
  printResultSet,
  csvEscape,
  isSensitiveColumn,
  columnMaskType,
  maskEmail,
  getHistoryPath,
  loadHistory,
  saveHistory,
  splitStatements,
  type PrintMode,
  type ShellLogger,
} from "./index.ts";
import type { ResultSet } from "@libsql/client";

// --- helpers ---

function makeResultSet(
  columns: string[],
  rows: unknown[][],
  rowsAffected = 0,
): ResultSet {
  return {
    columns,
    columnTypes: columns.map(() => "TEXT"),
    rows: rows as any,
    rowsAffected,
    lastInsertRowid: undefined as any,
    toJSON: () => ({}),
  };
}

/** Create a logger that captures output into the given array. */
function captureLogger(lines: string[]): ShellLogger {
  return {
    log: (msg?: string) => lines.push(msg ?? ""),
    error: (msg: string) => lines.push(msg),
    warn: (msg: string) => lines.push(msg),
    dim: (msg: string) => lines.push(msg),
    success: (msg: string) => lines.push(msg),
  };
}

// --- formatValue ---

describe("formatValue", () => {
  test("returns styled NULL for null", () => {
    const result = formatValue(null);
    expect(result).toContain("NULL");
  });

  test("converts numbers to string", () => {
    expect(formatValue(42)).toBe("42");
  });

  test("converts strings as-is", () => {
    expect(formatValue("hello")).toBe("hello");
  });

  test("converts booleans to string", () => {
    expect(formatValue(true)).toBe("true");
  });
});

// --- formatValueRaw ---

describe("formatValueRaw", () => {
  test("returns plain NULL for null", () => {
    expect(formatValueRaw(null)).toBe("NULL");
  });

  test("converts numbers to string", () => {
    expect(formatValueRaw(42)).toBe("42");
  });

  test("converts strings as-is", () => {
    expect(formatValueRaw("hello")).toBe("hello");
  });
});

// --- csvEscape ---

describe("csvEscape", () => {
  test("returns plain value when no special characters", () => {
    expect(csvEscape("hello")).toBe("hello");
  });

  test("wraps value with commas in quotes", () => {
    expect(csvEscape("hello,world")).toBe('"hello,world"');
  });

  test("wraps value with quotes and doubles them", () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  test("wraps value with newlines in quotes", () => {
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  test("handles empty string", () => {
    expect(csvEscape("")).toBe("");
  });
});

// --- printResultSet ---

describe("printResultSet", () => {
  test("json mode outputs JSON array of objects", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(["id", "name"], [[1, "Alice"], [2, "Bob"]]);
    printResultSet(rs, "json", true, log);
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
  });

  test("json mode with empty result", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(["id"], []);
    printResultSet(rs, "json", true, log);
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed).toEqual([]);
  });

  test("csv mode outputs header and rows", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(["id", "name"], [[1, "Alice"], [2, "Bob"]]);
    printResultSet(rs, "csv", true, log);
    expect(lines[0]).toBe("id,name");
    expect(lines[1]).toBe("1,Alice");
    expect(lines[2]).toBe("2,Bob");
  });

  test("csv mode escapes values with commas", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(["value"], [["hello,world"]]);
    printResultSet(rs, "csv", true, log);
    expect(lines[1]).toBe('"hello,world"');
  });

  test("csv mode shows NULL for null values", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(["value"], [[null]]);
    printResultSet(rs, "csv", true, log);
    expect(lines[1]).toBe("NULL");
  });

  test("no columns with rowsAffected shows affected message", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet([], [], 5);
    printResultSet(rs, "default", true, log);
    expect(lines[0]).toBe("Rows affected: 5");
  });

  test("no columns with zero rowsAffected shows nothing", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet([], [], 0);
    printResultSet(rs, "default", true, log);
    expect(lines).toHaveLength(0);
  });

  test("table mode produces output with headers", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(["id", "name"], [[1, "Alice"]]);
    printResultSet(rs, "table", true, log);
    const output = lines.join("\n");
    expect(output).toContain("id");
    expect(output).toContain("name");
    expect(output).toContain("Alice");
  });

  test("default mode produces output without box borders", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(["id", "name"], [[1, "Alice"]]);
    printResultSet(rs, "default", true, log);
    const output = lines.join("\n");
    expect(output).toContain("Alice");
    // default mode should not have the box-drawing borders that table mode has
    expect(output).not.toContain("┌");
    expect(output).not.toContain("└");
  });
});

// --- history ---

describe("history", () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "shell-test-"));
    originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tmpDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalEnv;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("getHistoryPath respects XDG_CONFIG_HOME", () => {
    const path = getHistoryPath();
    expect(path).toBe(join(tmpDir, "bunny", "shell_history"));
  });

  test("loadHistory returns empty array when file does not exist", () => {
    expect(loadHistory()).toEqual([]);
  });

  test("saveHistory creates directory and writes file", () => {
    saveHistory(["SELECT 1;", "SELECT 2;"]);
    const content = readFileSync(getHistoryPath(), "utf-8");
    expect(content).toBe("SELECT 1;\nSELECT 2;\n");
  });

  test("loadHistory reads saved entries", () => {
    saveHistory(["SELECT 1;", ".tables"]);
    const entries = loadHistory();
    expect(entries).toEqual(["SELECT 1;", ".tables"]);
  });

  test("saveHistory truncates to HISTORY_MAX", () => {
    const lines = Array.from({ length: 1500 }, (_, i) => `line ${i}`);
    saveHistory(lines);
    const loaded = loadHistory();
    expect(loaded).toHaveLength(1000);
    expect(loaded[0]).toBe("line 500");
    expect(loaded[999]).toBe("line 1499");
  });

  test("saveHistory overwrites existing file", () => {
    saveHistory(["first"]);
    saveHistory(["second"]);
    const loaded = loadHistory();
    expect(loaded).toEqual(["second"]);
  });

  test("loadHistory filters empty lines", () => {
    const path = getHistoryPath();
    const dir = join(tmpDir, "bunny");
    const { mkdirSync } = require("node:fs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, "line1\n\n\nline2\n", "utf-8");
    expect(loadHistory()).toEqual(["line1", "line2"]);
  });
});

// --- isSensitiveColumn ---

describe("isSensitiveColumn", () => {
  test("matches password variants", () => {
    expect(isSensitiveColumn("password")).toBe(true);
    expect(isSensitiveColumn("Password")).toBe(true);
    expect(isSensitiveColumn("password_hash")).toBe(true);
    expect(isSensitiveColumn("passwordHash")).toBe(true);
    expect(isSensitiveColumn("user_password")).toBe(true);
  });

  test("matches passwd", () => {
    expect(isSensitiveColumn("passwd")).toBe(true);
    expect(isSensitiveColumn("user_passwd")).toBe(true);
  });

  test("matches secret variants", () => {
    expect(isSensitiveColumn("secret")).toBe(true);
    expect(isSensitiveColumn("secret_key")).toBe(true);
    expect(isSensitiveColumn("client_secret")).toBe(true);
  });

  test("matches token variants", () => {
    expect(isSensitiveColumn("auth_token")).toBe(true);
    expect(isSensitiveColumn("access_token")).toBe(true);
    expect(isSensitiveColumn("refresh_token")).toBe(true);
  });

  test("matches api key variants", () => {
    expect(isSensitiveColumn("api_key")).toBe(true);
    expect(isSensitiveColumn("apikey")).toBe(true);
    expect(isSensitiveColumn("API_KEY")).toBe(true);
  });

  test("matches hash/encrypted prefixes", () => {
    expect(isSensitiveColumn("hashed_password")).toBe(true);
    expect(isSensitiveColumn("encrypted_data")).toBe(true);
  });

  test("matches other sensitive patterns", () => {
    expect(isSensitiveColumn("access_key")).toBe(true);
    expect(isSensitiveColumn("private_key")).toBe(true);
    expect(isSensitiveColumn("credit_card")).toBe(true);
    expect(isSensitiveColumn("creditcard")).toBe(true);
    expect(isSensitiveColumn("ssn")).toBe(true);
  });

  test("matches email columns", () => {
    expect(isSensitiveColumn("email")).toBe(true);
    expect(isSensitiveColumn("Email")).toBe(true);
    expect(isSensitiveColumn("user_email")).toBe(true);
    expect(isSensitiveColumn("e_mail")).toBe(true);
  });

  test("does not match safe columns", () => {
    expect(isSensitiveColumn("id")).toBe(false);
    expect(isSensitiveColumn("name")).toBe(false);
    expect(isSensitiveColumn("created_at")).toBe(false);
    expect(isSensitiveColumn("username")).toBe(false);
    expect(isSensitiveColumn("description")).toBe(false);
  });
});

// --- columnMaskType ---

describe("columnMaskType", () => {
  test("returns full for password columns", () => {
    expect(columnMaskType("password")).toBe("full");
    expect(columnMaskType("password_hash")).toBe("full");
  });

  test("returns email for email columns", () => {
    expect(columnMaskType("email")).toBe("email");
    expect(columnMaskType("user_email")).toBe("email");
  });

  test("returns none for safe columns", () => {
    expect(columnMaskType("id")).toBe("none");
    expect(columnMaskType("name")).toBe("none");
  });
});

// --- maskEmail ---

describe("maskEmail", () => {
  test("masks middle of local part", () => {
    expect(maskEmail("alice@example.com")).toBe("a••••e@example.com");
  });

  test("handles short local part (2 chars)", () => {
    expect(maskEmail("ab@example.com")).toBe("a••••b@example.com");
  });

  test("handles single char local part", () => {
    expect(maskEmail("a@example.com")).toBe("a••••@example.com");
  });

  test("handles long local part", () => {
    expect(maskEmail("alexander@example.com")).toBe("a••••r@example.com");
  });

  test("returns full mask for values without @", () => {
    expect(maskEmail("not-an-email")).toBe("********");
  });

  test("returns full mask for @ at start", () => {
    expect(maskEmail("@example.com")).toBe("********");
  });
});

// --- printResultSet masking ---

describe("printResultSet masking", () => {
  test("json mode masks sensitive columns", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(
      ["id", "name", "password_hash"],
      [[1, "Alice", "abc123"]],
    );
    printResultSet(rs, "json", true, log);
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed[0].id).toBe(1);
    expect(parsed[0].name).toBe("Alice");
    expect(parsed[0].password_hash).toBe("********");
  });

  test("json mode shows values when unmasked", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(
      ["id", "password_hash"],
      [[1, "abc123"]],
    );
    printResultSet(rs, "json", false, log);
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed[0].password_hash).toBe("abc123");
  });

  test("csv mode masks sensitive columns", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(
      ["id", "secret_key"],
      [[1, "mysecret"]],
    );
    printResultSet(rs, "csv", true, log);
    expect(lines[0]).toBe("id,secret_key");
    expect(lines[1]).toBe("1,********");
  });

  test("csv mode shows values when unmasked", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(
      ["id", "secret_key"],
      [[1, "mysecret"]],
    );
    printResultSet(rs, "csv", false, log);
    expect(lines[1]).toBe("1,mysecret");
  });

  test("table mode masks sensitive columns", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(
      ["id", "api_key"],
      [[1, "sk-abc123"]],
    );
    printResultSet(rs, "table", true, log);
    const output = lines.join("\n");
    expect(output).not.toContain("sk-abc123");
  });

  test("default mode masks sensitive columns", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(
      ["id", "password"],
      [[1, "hunter2"]],
    );
    printResultSet(rs, "default", true, log);
    const output = lines.join("\n");
    expect(output).not.toContain("hunter2");
  });

  test("null values are not masked", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(
      ["id", "password"],
      [[1, null]],
    );
    printResultSet(rs, "json", true, log);
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed[0].password).toBeNull();
  });

  test("non-sensitive columns are never masked", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(
      ["id", "name", "status"],
      [[1, "Alice", "active"]],
    );
    printResultSet(rs, "json", true, log);
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed[0].name).toBe("Alice");
    expect(parsed[0].status).toBe("active");
  });

  test("json mode partially masks email columns", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(
      ["id", "email"],
      [[1, "alice@example.com"]],
    );
    printResultSet(rs, "json", true, log);
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed[0].email).toBe("a••••e@example.com");
  });

  test("csv mode partially masks email columns", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(
      ["id", "email"],
      [[1, "alice@example.com"]],
    );
    printResultSet(rs, "csv", true, log);
    expect(lines[1]).toBe("1,a••••e@example.com");
  });

  test("email columns show full value when unmasked", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(
      ["id", "email"],
      [[1, "alice@example.com"]],
    );
    printResultSet(rs, "json", false, log);
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed[0].email).toBe("alice@example.com");
  });

  test("null email values are not masked", () => {
    const lines: string[] = [];
    const log = captureLogger(lines);
    const rs = makeResultSet(
      ["id", "email"],
      [[1, null]],
    );
    printResultSet(rs, "json", true, log);
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed[0].email).toBeNull();
  });
});

// --- splitStatements ---

describe("splitStatements", () => {
  test("splits multiple statements", () => {
    expect(splitStatements("SELECT 1; SELECT 2;")).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });

  test("handles trailing semicolon", () => {
    expect(splitStatements("SELECT 1;")).toEqual(["SELECT 1"]);
  });

  test("handles no trailing semicolon", () => {
    expect(splitStatements("SELECT 1")).toEqual(["SELECT 1"]);
  });

  test("filters empty segments", () => {
    expect(splitStatements("SELECT 1;; ;SELECT 2;")).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });

  test("handles multi-line statements", () => {
    const sql =
      "CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  name TEXT\n);\nINSERT INTO users VALUES (1, 'Alice');";
    expect(splitStatements(sql)).toEqual([
      "CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  name TEXT\n)",
      "INSERT INTO users VALUES (1, 'Alice')",
    ]);
  });

  test("returns empty array for empty input", () => {
    expect(splitStatements("")).toEqual([]);
  });

  test("returns empty array for whitespace-only input", () => {
    expect(splitStatements("   \n\n  ")).toEqual([]);
  });

  test("preserves semicolons inside single-quoted strings", () => {
    expect(splitStatements("INSERT INTO t VALUES ('a;b');")).toEqual([
      "INSERT INTO t VALUES ('a;b')",
    ]);
  });

  test("handles escaped quotes inside strings", () => {
    expect(
      splitStatements("INSERT INTO t VALUES ('O''Brien; Jr.');"),
    ).toEqual(["INSERT INTO t VALUES ('O''Brien; Jr.')"]);
  });

  test("handles multiple statements with embedded semicolons", () => {
    const sql =
      "INSERT INTO t VALUES ('x;y');\nSELECT * FROM t WHERE name = 'a;b';";
    expect(splitStatements(sql)).toEqual([
      "INSERT INTO t VALUES ('x;y')",
      "SELECT * FROM t WHERE name = 'a;b'",
    ]);
  });

  test("skips -- line comments", () => {
    const sql =
      "-- create table\nCREATE TABLE t (id INT);\n-- insert data\nINSERT INTO t VALUES (1);";
    expect(splitStatements(sql)).toEqual([
      "CREATE TABLE t (id INT)",
      "INSERT INTO t VALUES (1)",
    ]);
  });

  test("does not split on semicolons in comments", () => {
    const sql = "-- this; is a comment\nSELECT 1;";
    expect(splitStatements(sql)).toEqual(["SELECT 1"]);
  });
});
