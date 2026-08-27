import { connect } from "@bunny.net/database-client";
import type { APIRoute } from "astro";

export const prerender = false;

const db = () =>
  connect({
    url: import.meta.env.BUNNY_DATABASE_URL,
    authToken: import.meta.env.BUNNY_DATABASE_AUTH_TOKEN,
  });

export const GET: APIRoute = async () =>
  Response.json(
    await db().prepare("SELECT id, title FROM notes ORDER BY id").all(),
  );

export const POST: APIRoute = async ({ request }) => {
  const { title } = (await request.json()) as { title?: string };
  if (!title?.trim()) {
    return Response.json({ error: "A title is required." }, { status: 400 });
  }

  return Response.json(
    await db()
      .prepare("INSERT INTO notes (title) VALUES (?) RETURNING id, title")
      .bind(title.trim())
      .first(),
    { status: 201 },
  );
};
