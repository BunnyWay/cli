import { connect } from "@bunny.net/database-client";
import { env } from "$env/dynamic/private";
import type { RequestHandler } from "./$types";

const db = connect({
  url: env.BUNNY_DATABASE_URL,
  authToken: env.BUNNY_DATABASE_AUTH_TOKEN,
});

export const GET: RequestHandler = async () =>
  Response.json(
    await db.prepare("SELECT id, title FROM notes ORDER BY id").all(),
  );

export const POST: RequestHandler = async ({ request }) => {
  const { title } = (await request.json()) as { title?: string };
  if (!title?.trim()) {
    return Response.json({ error: "A title is required." }, { status: 400 });
  }

  return Response.json(
    await db
      .prepare("INSERT INTO notes (title) VALUES (?) RETURNING id, title")
      .bind(title.trim())
      .first(),
    { status: 201 },
  );
};
