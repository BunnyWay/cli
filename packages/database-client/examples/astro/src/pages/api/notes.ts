import { DatabaseError } from "@bunny.net/database-client";
import type { APIRoute } from "astro";
import { db, type Note, ready } from "../../lib/db";

// Without this the query runs once at build time and ships a frozen snapshot as static JSON.
export const prerender = false;

const failed = (cause: unknown) => {
  console.error(
    cause instanceof DatabaseError ? `${cause.code}: ${cause.message}` : cause,
  );
  return Response.json({ error: "Something went wrong." }, { status: 500 });
};

export const GET: APIRoute = async () => {
  try {
    await ready;

    return Response.json(
      await db
        .prepare("SELECT id, title, body FROM notes ORDER BY id")
        .all<Note>(),
    );
  } catch (cause) {
    return failed(cause);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    await ready;

    const payload = (await request
      .json()
      .catch(() => null)) as Partial<Note> | null;
    const title =
      typeof payload?.title === "string" ? payload.title.trim() : "";
    if (!title) {
      return Response.json({ error: "A title is required." }, { status: 400 });
    }

    const note = await db
      .prepare(
        "INSERT INTO notes (title, body) VALUES (?, ?) RETURNING id, title, body",
      )
      .bind(title, typeof payload?.body === "string" ? payload.body : "")
      .first<Note>();

    return Response.json(note, { status: 201 });
  } catch (cause) {
    return failed(cause);
  }
};
