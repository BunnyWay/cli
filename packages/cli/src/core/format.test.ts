import { test, expect, describe } from "bun:test";
import { csvEscape, formatTable, formatKeyValue } from "./format.ts";

// --- csvEscape ---

describe("csvEscape", () => {
  test("plain string unchanged", () => {
    expect(csvEscape("hello")).toBe("hello");
  });

  test("wraps value with commas", () => {
    expect(csvEscape("hello,world")).toBe('"hello,world"');
  });

  test("escapes double quotes", () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  test("wraps value with newlines", () => {
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  test("empty string unchanged", () => {
    expect(csvEscape("")).toBe("");
  });
});

// --- formatTable ---

describe("formatTable", () => {
  const headers = ["ID", "Name"];
  const rows = [
    ["1", "Alice"],
    ["2", "Bob"],
  ];

  test("csv format", () => {
    const result = formatTable(headers, rows, "csv");
    const lines = result.split("\n");
    expect(lines[0]).toBe("ID,Name");
    expect(lines[1]).toBe("1,Alice");
    expect(lines[2]).toBe("2,Bob");
    expect(lines.length).toBe(3);
  });

  test("csv escapes values with commas", () => {
    const result = formatTable(["Col"], [["a,b"]], "csv");
    expect(result).toBe('Col\n"a,b"');
  });

  test("markdown format", () => {
    const result = formatTable(headers, rows, "markdown");
    const lines = result.split("\n");
    expect(lines[0]).toBe("| ID | Name |");
    expect(lines[1]).toBe("| --- | --- |");
    expect(lines[2]).toBe("| 1 | Alice |");
    expect(lines[3]).toBe("| 2 | Bob |");
    expect(lines.length).toBe(4);
  });

  test("markdown escapes pipe characters", () => {
    const result = formatTable(["Col"], [["a|b"]], "markdown");
    const lines = result.split("\n");
    expect(lines[2]).toBe("| a\\|b |");
  });

  test("table format produces bordered table", () => {
    const result = formatTable(headers, rows, "table");
    expect(result).toContain("ID");
    expect(result).toContain("Name");
    expect(result).toContain("Alice");
    expect(result).toContain("─");
  });

  test("text format produces borderless table", () => {
    const result = formatTable(headers, rows, "text");
    expect(result).toContain("Alice");
    expect(result).toContain("Bob");
    // Should not have box-drawing border characters
    expect(result).not.toContain("─");
  });

  test("empty rows", () => {
    const result = formatTable(headers, [], "csv");
    expect(result).toBe("ID,Name");
  });

  test("handles null/undefined values in rows", () => {
    const result = formatTable(["Col"], [[""], [""]], "csv");
    const lines = result.split("\n");
    expect(lines.length).toBe(3);
  });
});

// --- formatKeyValue ---

describe("formatKeyValue", () => {
  const entries = [
    { key: "Name", value: "Alice" },
    { key: "Role", value: "Admin" },
  ];

  test("csv format renders as Key,Value table", () => {
    const result = formatKeyValue(entries, "csv");
    const lines = result.split("\n");
    expect(lines[0]).toBe("Key,Value");
    expect(lines[1]).toBe("Name,Alice");
    expect(lines[2]).toBe("Role,Admin");
  });

  test("markdown format renders as pipe table", () => {
    const result = formatKeyValue(entries, "markdown");
    const lines = result.split("\n");
    expect(lines[0]).toBe("| Key | Value |");
    expect(lines[1]).toBe("| --- | --- |");
    expect(lines[2]).toBe("| Name | Alice |");
    expect(lines[3]).toBe("| Role | Admin |");
  });

  test("table format includes headers and values", () => {
    const result = formatKeyValue(entries, "table");
    expect(result).toContain("Key");
    expect(result).toContain("Value");
    expect(result).toContain("Alice");
  });

  test("text format includes values", () => {
    const result = formatKeyValue(entries, "text");
    expect(result).toContain("Alice");
    expect(result).toContain("Admin");
  });

  test("empty entries", () => {
    const result = formatKeyValue([], "csv");
    expect(result).toBe("Key,Value");
  });
});
