import { connect } from "@bunny.net/database-client";

const db = () => connect();

export async function GET() {
  return Response.json(
    await db().prepare("SELECT id, title FROM notes ORDER BY id").all(),
  );
}

export async function POST(request: Request) {
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
}
