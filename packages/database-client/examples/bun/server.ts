import { connect, DatabaseError } from "@bunny.net/database-client";

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

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

function noteId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const server = Bun.serve({
  routes: {
    "/notes": {
      GET: async () =>
        Response.json(
          await db
            .prepare("SELECT id, title, body FROM notes ORDER BY id")
            .all<Note>(),
        ),

      POST: async (request) => {
        const payload = (await request
          .json()
          .catch(() => null)) as Partial<Note> | null;
        const title =
          typeof payload?.title === "string" ? payload.title.trim() : "";
        if (!title) {
          return Response.json(
            { error: "A title is required." },
            { status: 400 },
          );
        }

        const note = await db
          .prepare(
            "INSERT INTO notes (title, body) VALUES (?, ?) RETURNING id, title, body",
          )
          .bind(title, typeof payload?.body === "string" ? payload.body : "")
          .first<Note>();

        return Response.json(note, { status: 201 });
      },
    },

    "/notes/:id": {
      GET: async (request) => {
        const id = noteId(request.params.id);
        if (id === null) return notFound();

        const note = await db
          .prepare("SELECT id, title, body FROM notes WHERE id = ?")
          .bind(id)
          .first<Note>();

        return note ? Response.json(note) : notFound();
      },

      DELETE: async (request) => {
        const id = noteId(request.params.id);
        if (id === null) return notFound();

        const { rowsAffected } = await db
          .prepare("DELETE FROM notes WHERE id = ?")
          .bind(id)
          .run();

        return rowsAffected ? new Response(null, { status: 204 }) : notFound();
      },
    },
  },

  error(cause) {
    console.error(
      cause instanceof DatabaseError
        ? `${cause.code}: ${cause.message}`
        : cause,
    );
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  },
});

console.log(`listening on ${server.url}`);
