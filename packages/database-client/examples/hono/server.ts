import { connect, DatabaseError } from "@bunny.net/database-client";
import { Hono } from "hono";

const db = connect();

await db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT ''
  )
`);

interface Note {
  id: number;
  title: string;
  body: string;
}

const app = new Hono();

app.get("/notes", async (c) =>
  c.json(
    await db
      .prepare("SELECT id, title, body FROM notes ORDER BY id")
      .all<Note>(),
  ),
);

app.post("/notes", async (c) => {
  const payload = (await c.req
    .json()
    .catch(() => null)) as Partial<Note> | null;
  const title = typeof payload?.title === "string" ? payload.title.trim() : "";
  if (!title) return c.json({ error: "A title is required." }, 400);

  const note = await db
    .prepare(
      "INSERT INTO notes (title, body) VALUES (?, ?) RETURNING id, title, body",
    )
    .bind(title, typeof payload?.body === "string" ? payload.body : "")
    .first<Note>();

  return c.json(note, 201);
});

app.get("/notes/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id)) return c.notFound();

  const note = await db
    .prepare("SELECT id, title, body FROM notes WHERE id = ?")
    .bind(id)
    .first<Note>();

  return note ? c.json(note) : c.notFound();
});

app.delete("/notes/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id)) return c.notFound();

  const { rowsAffected } = await db
    .prepare("DELETE FROM notes WHERE id = ?")
    .bind(id)
    .run();

  return rowsAffected ? c.body(null, 204) : c.notFound();
});

app.onError((cause, c) => {
  console.error(
    cause instanceof DatabaseError ? `${cause.code}: ${cause.message}` : cause,
  );
  return c.json({ error: "Something went wrong." }, 500);
});

export default app;
