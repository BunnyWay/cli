import { connect, DatabaseError } from "npm:@bunny.net/database-client";
import * as BunnySDK from "npm:@bunny.net/edgescript-sdk@0.12.1";

const db = connect();

// Creates the schema on startup.
// Use migrations for anything beyond a demo.
// https://docs.bunny.net/database
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

const error = (message: string, status: number) =>
  Response.json({ error: message }, { status });

const notFound = () => error("Not found", 404);

// Rejects a missing or blank title, and defaults body to an empty string.
async function readPayload(request: Request) {
  const payload = (await request
    .json()
    .catch(() => null)) as Partial<Note> | null;
  const title = typeof payload?.title === "string" ? payload.title.trim() : "";
  if (!title) return null;
  return { title, body: typeof payload?.body === "string" ? payload.body : "" };
}

/**
 * A CRUD API backed by Bunny Database.
 *
 * GET    /           a hello message pointing at the notes endpoint
 * GET    /notes      list every note
 * POST   /notes      create a note from a { title, body } payload
 * GET    /notes/:id  read a single note
 * PUT    /notes/:id  replace a note
 * DELETE /notes/:id  remove a note
 *
 * Reads are served from the replica closest to the request, writes go to the primary region.
 *
 * @param {Request} request - The Fetch API Request object.
 * @return {Response} The HTTP response.
 */
BunnySDK.net.http.serve(async (request: Request): Promise<Response> => {
  const { pathname } = new URL(request.url);
  const [, resource, id] = pathname.split("/");

  if (!resource) {
    const notes = new URL("/notes", request.url).href;

    return Response.json({
      message: "Hello from Bunny Edge Scripting.",
      notes,
      example: `curl ${notes}`,
    });
  }

  if (resource !== "notes") return notFound();

  try {
    if (!id) {
      if (request.method === "GET") {
        const notes = await db
          .prepare("SELECT id, title, body FROM notes ORDER BY id")
          .all<Note>();

        return Response.json(notes);
      }

      if (request.method === "POST") {
        const payload = await readPayload(request);
        if (!payload) return error("A title is required.", 400);

        const note = await db
          .prepare(
            "INSERT INTO notes (title, body) VALUES (?, ?) RETURNING id, title, body",
          )
          .bind(payload.title, payload.body)
          .first<Note>();

        return Response.json(note, { status: 201 });
      }

      return error("Method not allowed", 405);
    }

    // Bind the id as a number so a path like /notes/abc never reaches SQLite.
    const noteId = Number(id);
    if (!Number.isSafeInteger(noteId)) return notFound();

    if (request.method === "GET") {
      const note = await db
        .prepare("SELECT id, title, body FROM notes WHERE id = ?")
        .bind(noteId)
        .first<Note>();

      return note ? Response.json(note) : notFound();
    }

    if (request.method === "PUT") {
      const payload = await readPayload(request);
      if (!payload) return error("A title is required.", 400);

      const note = await db
        .prepare(
          "UPDATE notes SET title = ?, body = ? WHERE id = ? RETURNING id, title, body",
        )
        .bind(payload.title, payload.body, noteId)
        .first<Note>();

      return note ? Response.json(note) : notFound();
    }

    if (request.method === "DELETE") {
      const { rowsAffected } = await db
        .prepare("DELETE FROM notes WHERE id = ?")
        .bind(noteId)
        .run();

      return rowsAffected ? new Response(null, { status: 204 }) : notFound();
    }

    return error("Method not allowed", 405);
  } catch (cause) {
    console.error(
      cause instanceof DatabaseError
        ? `${cause.code}: ${cause.message}`
        : cause,
    );
    return error("Something went wrong.", 500);
  }
});
