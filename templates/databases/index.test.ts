import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { splitStatements } from "../../packages/database-shell/src/parser.ts";

interface DatabaseTemplate {
  id: string;
  name: string;
  description: string;
  tables: string[];
  views?: string[];
}

const dir = import.meta.dir;
const index: DatabaseTemplate[] = await Bun.file(
  join(dir, "index.json"),
).json();

function objectNames(db: Database, type: "table" | "view"): string[] {
  return db
    .query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all(type)
    .map((row) => row.name);
}

test("every indexed template has an icon and a schema that applies twice to SQLite and creates exactly the listed tables and views", async () => {
  expect(index.length).toBeGreaterThan(0);
  for (const template of index) {
    expect(await Bun.file(join(dir, `${template.id}.svg`)).exists()).toBe(true);
    const sql = await Bun.file(join(dir, `${template.id}.sql`)).text();
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const statement of splitStatements(sql)) db.exec(statement);
    db.exec(sql);
    expect(objectNames(db, "table")).toEqual([...template.tables].sort());
    expect(objectNames(db, "view")).toEqual([...(template.views ?? [])].sort());
    db.close();
  }
});

test("every schema and icon file belongs to an indexed template", () => {
  const ids = new Set(index.map((template) => template.id));
  for (const file of readdirSync(dir)) {
    const match = file.match(/^(.+)\.(sql|svg)$/);
    if (match) expect(ids.has(match[1]!)).toBe(true);
  }
});
