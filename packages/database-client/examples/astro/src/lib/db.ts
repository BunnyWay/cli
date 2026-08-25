import { connect } from "@bunny.net/database-client";

export const db = connect();

// One CREATE TABLE per server process, awaited by any route that needs the table.
export const ready = db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT ''
  )
`);

export interface Note {
  id: number;
  title: string;
  body: string;
}
