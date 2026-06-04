import { ENV_DATABASE_AUTH_TOKEN, ENV_DATABASE_URL } from "./constants.ts";

export const QUICKSTART_LANGUAGES = [
  { id: "typescript", title: "TypeScript" },
  { id: "go", title: "Go" },
  { id: "rust", title: "Rust" },
  { id: "dotnet", title: ".NET" },
] as const;

export type QuickstartLang = (typeof QUICKSTART_LANGUAGES)[number]["id"];

export interface Snippet {
  lang: string;
  install: string;
  code: string;
}

interface SnippetVars {
  urlEnv: string;
  tokenEnv: string;
}

const TEMPLATES: Record<QuickstartLang, (vars: SnippetVars) => Snippet> = {
  typescript: ({ urlEnv, tokenEnv }) => ({
    lang: "TypeScript",
    install: "bun add @libsql/client",
    code: `import { createClient } from "@libsql/client/web";

const client = createClient({
  url: process.env.${urlEnv},
  authToken: process.env.${tokenEnv},
});

await client.execute("SELECT * FROM users");`,
  }),
  go: ({ urlEnv, tokenEnv }) => ({
    lang: "Go",
    install: "go get github.com/tursodatabase/libsql-client-go/libsql",
    code: `package main

import (
\t"database/sql"
\t"fmt"
\t"os"

\t_ "github.com/tursodatabase/libsql-client-go/libsql"
)

func main() {
\turl := fmt.Sprintf("%s?authToken=%s",
\t\tos.Getenv("${urlEnv}"),
\t\tos.Getenv("${tokenEnv}"),
\t)

\tdb, err := sql.Open("libsql", url)
\tif err != nil {
\t\tfmt.Fprintf(os.Stderr, "failed to open db %s: %s", url, err)
\t\tos.Exit(1)
\t}
\tdefer db.Close()
}`,
  }),
  rust: ({ urlEnv, tokenEnv }) => ({
    lang: "Rust",
    install: "cargo add libsql",
    code: `use libsql::Builder;

let url = std::env::var("${urlEnv}").expect("${urlEnv} must be set");
let token = std::env::var("${tokenEnv}").expect("${tokenEnv} must be set");

let db = Builder::new_remote(url, token)
    .build()
    .await?;

let conn = db.connect()?;

let mut rows = conn.query("SELECT * FROM users", ()).await?;

while let Some(row) = rows.next().await? {
    let id: i64 = row.get(0)?;
    let name: String = row.get(1)?;
    println!("User: {} - {}", id, name);
}`,
  }),
  dotnet: ({ urlEnv, tokenEnv }) => ({
    lang: ".NET",
    install: "dotnet add package Bunny.LibSql.Client",
    code: `var db = new AppDb(
    Environment.GetEnvironmentVariable("${urlEnv}"),
    Environment.GetEnvironmentVariable("${tokenEnv}")
);

await db.ApplyMigrationsAsync();

var users = await db.Users.ToListAsync();

foreach (var user in users)
{
    Console.WriteLine($"User: {user.name}");
}`,
  }),
};

/** Return the install command and connection code snippet for a language. */
export function getSnippet(lang: QuickstartLang): Snippet {
  return TEMPLATES[lang]({
    urlEnv: ENV_DATABASE_URL,
    tokenEnv: ENV_DATABASE_AUTH_TOKEN,
  });
}
