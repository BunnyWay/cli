import { connect } from "@bunny.net/database-client";
import { revalidatePath } from "next/cache";

const db = connect();

export default async function Page() {
  const notes = await db
    .prepare("SELECT id, title FROM notes ORDER BY id")
    .all<{ id: number; title: string }>();

  async function create(formData: FormData) {
    "use server";
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return;

    await db.prepare("INSERT INTO notes (title) VALUES (?)").bind(title).run();
    revalidatePath("/");
  }

  return (
    <main>
      <form action={create}>
        <input name="title" placeholder="Note title" />
        <button type="submit">Add</button>
      </form>
      <ul>
        {notes.map((note) => (
          <li key={note.id}>{note.title}</li>
        ))}
      </ul>
    </main>
  );
}
