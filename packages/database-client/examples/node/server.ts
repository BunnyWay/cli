/**
 * A notes API on Node with no framework. Node does not read .env on its own,
 * and running TypeScript without a build step needs Node 24 or newer:
 *
 *   node --env-file=.env examples/node/server.ts
 */
import { createServer } from "node:http";
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

const server = createServer(async (request, response) => {
  const send = (status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };

  try {
    if (request.url !== "/notes") return send(404, { error: "Not found" });

    if (request.method === "GET") {
      return send(
        200,
        await db
          .prepare("SELECT id, title, body FROM notes ORDER BY id")
          .all<Note>(),
      );
    }

    if (request.method === "POST") {
      let raw = "";
      for await (const chunk of request) raw += chunk;

      const payload = (() => {
        try {
          return JSON.parse(raw) as Partial<Note>;
        } catch {
          return null;
        }
      })();

      const title =
        typeof payload?.title === "string" ? payload.title.trim() : "";
      if (!title) return send(400, { error: "A title is required." });

      const note = await db
        .prepare(
          "INSERT INTO notes (title, body) VALUES (?, ?) RETURNING id, title, body",
        )
        .bind(title, typeof payload?.body === "string" ? payload.body : "")
        .first<Note>();

      return send(201, note);
    }

    return send(405, { error: "Method not allowed" });
  } catch (cause) {
    // The server message and SQLite code stay in the log; the client gets nothing specific.
    console.error(
      cause instanceof DatabaseError
        ? `${cause.code}: ${cause.message}`
        : cause,
    );
    send(500, { error: "Something went wrong." });
  }
});

server.listen(3000, () => console.log("listening on http://localhost:3000"));
