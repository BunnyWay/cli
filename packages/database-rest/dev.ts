import {
  createLibSQLExecutor,
  introspect,
} from "@bunny.net/database-adapter-libsql";
import { createClient } from "@libsql/client";
import { createRestHandler } from "./src/index.ts";

const client = createClient({ url: ":memory:" });

await client.executeMultiple(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    age INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO users (name, email, age) VALUES ('Alice', 'alice@example.com', 30);
  INSERT INTO users (name, email, age) VALUES ('Bob', 'bob@example.com', 25);
  INSERT INTO users (name, email, age) VALUES ('Charlie', 'charlie@example.com', NULL);

  CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT,
    published INTEGER NOT NULL DEFAULT 0,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO posts (title, body, published, user_id) VALUES ('Hello World', 'My first post', 1, 1);
  INSERT INTO posts (title, body, published, user_id) VALUES ('Draft Post', NULL, 0, 2);
  INSERT INTO posts (title, body, published, user_id) VALUES ('Another Post', 'Some content here', 1, 1);
`);

const schema = await introspect({ client });
const executor = createLibSQLExecutor({ client });
const handler = createRestHandler(executor, schema);

const port = Number(process.env.PORT) || 8080;
const server = Bun.serve({ port, fetch: handler });

console.log(`Listening on http://localhost:${server.port}`);
console.log();
console.log("Try:");
const base = `http://localhost:${server.port}`;
console.log(`  curl ${base}/                              # OpenAPI spec`);
console.log(`  curl ${base}/users                         # List users`);
console.log(`  curl ${base}/users?select=id,name          # Select columns`);
console.log(`  curl ${base}/users?age=gte.25              # Filter`);
console.log(`  curl ${base}/users?order=name.desc         # Order`);
console.log(`  curl ${base}/users?limit=1&offset=1        # Paginate`);
console.log(`  curl ${base}/posts?published=eq.1          # Filter posts`);
console.log(`  curl ${base}/users/1                       # Get user by ID`);
console.log(
  `  curl ${base}/users/1?select=id,name        # Get user by ID with select`,
);
console.log(`  curl -X POST ${base}/users \\`);
console.log(`    -H 'Content-Type: application/json' \\`);
console.log(
  `    -d '{"name":"Dave","email":"dave@example.com"}'          # Insert`,
);
console.log(`  curl -X PATCH ${base}/users/1 \\`);
console.log(`    -H 'Content-Type: application/json' \\`);
console.log(
  `    -d '{"age":31}'                                         # Update by ID`,
);
console.log(`  curl -X DELETE ${base}/users/4             # Delete by ID`);
