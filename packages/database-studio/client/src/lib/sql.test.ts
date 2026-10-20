import { expect, test } from "bun:test";
import { quoteIdent, statementAt } from "./sql.ts";

test("statementAt ignores semicolons in quotes and comments", () => {
  const doc = "SELECT ';' AS semi;\n-- note; here\nSELECT 3";
  expect(statementAt(doc, 3)).toBe("SELECT ';' AS semi");
  expect(statementAt(doc, doc.length)).toBe("-- note; here\nSELECT 3");
});

test("statementAt runs the statement a cursor just after or below it ends", () => {
  expect(statementAt("SELECT 1;\nSELECT 2", 9)).toBe("SELECT 1");
  expect(statementAt("SELECT 1;\n\n", 11)).toBe("SELECT 1");
});

test("quoteIdent escapes embedded quotes", () => {
  expect(quoteIdent('a"b')).toBe('"a""b"');
});
