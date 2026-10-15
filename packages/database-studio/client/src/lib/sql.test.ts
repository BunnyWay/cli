import { describe, expect, test } from "bun:test";
import { quoteIdent, statementAt } from "./sql.ts";

describe("statementAt", () => {
  const doc = "SELECT 1;\nSELECT ';' AS semi;\n-- note; here\nSELECT 3";

  test("returns the statement under the cursor", () => {
    expect(statementAt(doc, 3)).toBe("SELECT 1");
    expect(statementAt(doc, doc.indexOf("AS semi"))).toBe("SELECT ';' AS semi");
    expect(statementAt(doc, doc.length)).toBe("-- note; here\nSELECT 3");
  });

  test("a cursor just after a semicolon runs the statement it ends", () => {
    expect(statementAt(doc, doc.indexOf(";") + 1)).toBe("SELECT 1");
  });

  test("a cursor on trailing blank lines runs the last statement", () => {
    expect(statementAt("SELECT 1;\n\n", 11)).toBe("SELECT 1");
  });

  test("a single statement without a semicolon is the whole document", () => {
    expect(statementAt("  SELECT * FROM t  ", 0)).toBe("SELECT * FROM t");
  });
});

describe("quoteIdent", () => {
  test("quotes every name, so keywords work as table names", () => {
    expect(quoteIdent("order")).toBe('"order"');
    expect(quoteIdent("user roles")).toBe('"user roles"');
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });
});
