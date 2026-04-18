import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import type { DatabaseSchema } from "@bunny.net/database-openapi";
import { createRestHandler } from "./handler.ts";
import type { DatabaseExecutor } from "./executor.ts";

// Minimal executor for testing - mirrors what an adapter would do
const createTestExecutor = (client: Client): DatabaseExecutor => ({
  execute: async (sql, args) => {
    const result = await client.execute({ sql, args });
    return {
      columns: result.columns,
      rows: result.rows as Record<string, unknown>[],
    };
  },
});

let client: Client;
let executor: DatabaseExecutor;
let schema: DatabaseSchema;
let handler: (req: Request) => Promise<Response>;

beforeAll(async () => {
  client = createClient({ url: ":memory:" });
  executor = createTestExecutor(client);

  await client.executeMultiple(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      age INTEGER
    );
    INSERT INTO users (name, email, age) VALUES ('Alice', 'alice@example.com', 30);
    INSERT INTO users (name, email, age) VALUES ('Bob', 'bob@example.com', 25);
    INSERT INTO users (name, email, age) VALUES ('Charlie', 'charlie@example.com', NULL);

    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT,
      user_id INTEGER NOT NULL REFERENCES users(id)
    );
    INSERT INTO posts (title, body, user_id) VALUES ('Hello', 'World', 1);
    INSERT INTO posts (title, body, user_id) VALUES ('Second', NULL, 2);

    CREATE TABLE "user roles" (
      id INTEGER PRIMARY KEY,
      role TEXT NOT NULL
    );
    INSERT INTO "user roles" (role) VALUES ('admin');
    INSERT INTO "user roles" (role) VALUES ('editor');
  `);

  // Inline schema for testing - no introspection dependency needed
  schema = {
    tables: {
      users: {
        name: "users",
        columns: [
          { name: "id", type: "INTEGER", nullable: false, primaryKey: true },
          { name: "name", type: "TEXT", nullable: false, primaryKey: false },
          { name: "email", type: "TEXT", nullable: false, primaryKey: false },
          { name: "age", type: "INTEGER", nullable: true, primaryKey: false },
        ],
        primaryKey: ["id"],
        foreignKeys: [],
        indexes: [{ name: "idx_users_email", columns: ["email"], unique: true }],
        uniqueColumns: ["email"],
      },
      posts: {
        name: "posts",
        columns: [
          { name: "id", type: "INTEGER", nullable: false, primaryKey: true },
          { name: "title", type: "TEXT", nullable: false, primaryKey: false },
          { name: "body", type: "TEXT", nullable: true, primaryKey: false },
          { name: "user_id", type: "INTEGER", nullable: false, primaryKey: false },
        ],
        primaryKey: ["id"],
        foreignKeys: [{ column: "user_id", referencesTable: "users", referencesColumn: "id" }],
        indexes: [],
        uniqueColumns: [],
      },
      "user roles": {
        name: "user roles",
        columns: [
          { name: "id", type: "INTEGER", nullable: false, primaryKey: true },
          { name: "role", type: "TEXT", nullable: false, primaryKey: false },
        ],
        primaryKey: ["id"],
        foreignKeys: [],
        indexes: [],
        uniqueColumns: [],
      },
    },
    version: "1.0.0",
  };

  handler = createRestHandler(executor, schema);
});

afterAll(() => {
  client.close();
});

const req = (method: string, path: string, body?: unknown): Request => {
  const url = `http://localhost${path}`;
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsonBody = async (res: Response): Promise<any> => res.json();

describe("GET / (OpenAPI spec)", () => {
  test("returns OpenAPI spec", async () => {
    const res = await handler(req("GET", "/"));
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.openapi).toBe("3.0.3");
    expect(body.paths["/users"]).toBeDefined();
    expect(body.paths["/posts"]).toBeDefined();
  });
});

describe("GET /:table", () => {
  test("returns all rows", async () => {
    const res = await handler(req("GET", "/users"));
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.data).toHaveLength(3);
    expect(res.headers.get("X-Total-Count")).toBe("3");
  });

  test("select specific columns", async () => {
    const res = await handler(req("GET", "/users?select=id,name"));
    const body = await jsonBody(res);

    expect(Object.keys(body.data[0])).toEqual(["id", "name"]);
  });

  test("filter with eq", async () => {
    const res = await handler(req("GET", "/users?name=eq.Alice"));
    const body = await jsonBody(res);

    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("Alice");
  });

  test("filter with gte", async () => {
    const res = await handler(req("GET", "/users?age=gte.30"));
    const body = await jsonBody(res);

    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("Alice");
  });

  test("filter with is.null", async () => {
    const res = await handler(req("GET", "/users?age=is.null"));
    const body = await jsonBody(res);

    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("Charlie");
  });

  test("filter with in", async () => {
    const res = await handler(req("GET", "/users?name=in.(Alice,Bob)"));
    const body = await jsonBody(res);

    expect(body.data).toHaveLength(2);
  });

  test("order by column desc", async () => {
    const res = await handler(req("GET", "/users?order=name.desc"));
    const body = await jsonBody(res);

    expect(body.data[0].name).toBe("Charlie");
    expect(body.data[2].name).toBe("Alice");
  });

  test("limit and offset", async () => {
    const res = await handler(req("GET", "/users?order=id.asc&limit=1&offset=1"));
    const body = await jsonBody(res);

    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("Bob");
    expect(res.headers.get("X-Total-Count")).toBe("3");
  });

  test("returns 404 for unknown table", async () => {
    const res = await handler(req("GET", "/nonexistent"));
    expect(res.status).toBe(404);

    const body = await jsonBody(res);
    expect(body.code).toBe("NOT_FOUND");
  });
});

describe("POST /:table", () => {
  test("inserts a single row", async () => {
    const res = await handler(
      req("POST", "/users", { name: "Dave", email: "dave@example.com", age: 40 }),
    );
    expect(res.status).toBe(201);

    const body = await jsonBody(res);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("Dave");
    expect(body.data[0].id).toBeDefined();
  });

  test("inserts multiple rows", async () => {
    const res = await handler(
      req("POST", "/users", [
        { name: "Eve", email: "eve@example.com" },
        { name: "Frank", email: "frank@example.com" },
      ]),
    );
    expect(res.status).toBe(201);

    const body = await jsonBody(res);
    expect(body.data).toHaveLength(2);
  });

  test("returns 400 for empty body", async () => {
    const res = await handler(req("POST", "/users", []));
    expect(res.status).toBe(400);
  });

  test("returns 400 for non-object body", async () => {
    const res = await handler(req("POST", "/users", "invalid"));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /:table", () => {
  test("updates matching rows", async () => {
    const res = await handler(
      req("PATCH", "/users?name=eq.Alice", { age: 31 }),
    );
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].age).toBe(31);
  });

  test("returns 400 without filters", async () => {
    const res = await handler(req("PATCH", "/users", { age: 99 }));
    expect(res.status).toBe(400);

    const body = await jsonBody(res);
    expect(body.message).toContain("Filters are required");
  });

  test("returns 400 for empty body", async () => {
    const res = await handler(req("PATCH", "/users?id=eq.1", {}));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /:table", () => {
  test("deletes matching rows", async () => {
    await handler(
      req("POST", "/users", { name: "ToDelete", email: "del@example.com" }),
    );

    const res = await handler(req("DELETE", "/users?name=eq.ToDelete"));
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("ToDelete");

    const check = await handler(req("GET", "/users?name=eq.ToDelete"));
    const checkBody = await jsonBody(check);
    expect(checkBody.data).toHaveLength(0);
  });

  test("returns 400 without filters", async () => {
    const res = await handler(req("DELETE", "/users"));
    expect(res.status).toBe(400);

    const body = await jsonBody(res);
    expect(body.message).toContain("Filters are required");
  });
});

describe("GET /:table/by-:column/:value", () => {
  test("returns a single row by unique column", async () => {
    const res = await handler(req("GET", "/users/by-email/alice@example.com"));
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.data.name).toBe("Alice");
    expect(Array.isArray(body.data)).toBe(false);
  });

  test("supports select on unique column lookup", async () => {
    const res = await handler(req("GET", "/users/by-email/alice@example.com?select=id,name"));
    const body = await jsonBody(res);

    expect(Object.keys(body.data)).toEqual(["id", "name"]);
  });

  test("returns 404 for non-existent value", async () => {
    const res = await handler(req("GET", "/users/by-email/nobody@example.com"));
    expect(res.status).toBe(404);
  });

  test("returns 404 for non-unique column", async () => {
    const res = await handler(req("GET", "/users/by-name/Alice"));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /:table/by-:column/:value", () => {
  test("updates a single row by unique column", async () => {
    const res = await handler(
      req("PATCH", "/users/by-email/bob@example.com", { age: 27 }),
    );
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.data.age).toBe(27);
    expect(body.data.name).toBe("Bob");
  });

  test("returns 404 for non-existent value", async () => {
    const res = await handler(
      req("PATCH", "/users/by-email/nobody@example.com", { age: 99 }),
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /:table/by-:column/:value", () => {
  test("deletes a single row by unique column", async () => {
    await handler(
      req("POST", "/users", { name: "UniqueDelete", email: "unique-del@example.com" }),
    );

    const res = await handler(req("DELETE", "/users/by-email/unique-del@example.com"));
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.data.name).toBe("UniqueDelete");

    const check = await handler(req("GET", "/users/by-email/unique-del@example.com"));
    expect(check.status).toBe(404);
  });

  test("returns 404 for non-existent value", async () => {
    const res = await handler(req("DELETE", "/users/by-email/nobody@example.com"));
    expect(res.status).toBe(404);
  });
});

describe("basePath option", () => {
  test("strips base path before routing", async () => {
    const apiHandler = createRestHandler(executor, schema, { basePath: "/api" });

    const specRes = await apiHandler(req("GET", "/api/"));
    expect(specRes.status).toBe(200);
    const specBody = await jsonBody(specRes);
    expect(specBody.openapi).toBe("3.0.3");

    const dataRes = await apiHandler(req("GET", "/api/users"));
    expect(dataRes.status).toBe(200);
    const dataBody = await jsonBody(dataRes);
    expect(dataBody.data.length).toBeGreaterThan(0);
  });

  test("returns 404 for paths without base", async () => {
    const apiHandler = createRestHandler(executor, schema, { basePath: "/api" });

    const res = await apiHandler(req("GET", "/users"));
    expect(res.status).toBe(404);
  });
});

describe("GET /:table/:id", () => {
  test("returns a single row by PK", async () => {
    const res = await handler(req("GET", "/users/1"));
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.data.name).toBe("Alice");
    expect(Array.isArray(body.data)).toBe(false);
  });

  test("supports select on single resource", async () => {
    const res = await handler(req("GET", "/users/1?select=id,name"));
    const body = await jsonBody(res);

    expect(Object.keys(body.data)).toEqual(["id", "name"]);
  });

  test("returns 404 for non-existent row", async () => {
    const res = await handler(req("GET", "/users/9999"));
    expect(res.status).toBe(404);

    const body = await jsonBody(res);
    expect(body.code).toBe("NOT_FOUND");
  });

  test("returns 404 for non-existent table", async () => {
    const res = await handler(req("GET", "/nonexistent/1"));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /:table/:id", () => {
  test("updates a single row by PK", async () => {
    const res = await handler(
      req("PATCH", "/users/2", { age: 26 }),
    );
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.data.age).toBe(26);
    expect(body.data.name).toBe("Bob");
    expect(Array.isArray(body.data)).toBe(false);
  });

  test("returns 404 for non-existent row", async () => {
    const res = await handler(
      req("PATCH", "/users/9999", { name: "Nobody" }),
    );
    expect(res.status).toBe(404);
  });

  test("returns 400 for empty body", async () => {
    const res = await handler(req("PATCH", "/users/1", {}));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /:table/:id", () => {
  test("deletes a single row by PK", async () => {
    await handler(
      req("POST", "/users", { name: "Temp", email: "temp@example.com" }),
    );

    const findRes = await handler(req("GET", "/users?name=eq.Temp"));
    const findBody = await jsonBody(findRes);
    const id = findBody.data[0].id;

    const res = await handler(req("DELETE", `/users/${id}`));
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.data.name).toBe("Temp");
    expect(Array.isArray(body.data)).toBe(false);

    const check = await handler(req("GET", `/users/${id}`));
    expect(check.status).toBe(404);
  });

  test("returns 404 for non-existent row", async () => {
    const res = await handler(req("DELETE", "/users/9999"));
    expect(res.status).toBe(404);
  });
});

describe("tables with spaces in names", () => {
  test("GET collection with encoded table name", async () => {
    const res = await handler(req("GET", "/user%20roles"));
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.data).toHaveLength(2);
  });

  test("GET single resource with encoded table name", async () => {
    const res = await handler(req("GET", "/user%20roles/1"));
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.data.role).toBe("admin");
  });

  test("POST with encoded table name", async () => {
    const res = await handler(
      req("POST", "/user%20roles", { role: "viewer" }),
    );
    expect(res.status).toBe(201);

    const body = await jsonBody(res);
    expect(body.data[0].role).toBe("viewer");
  });

  test("PATCH single resource with encoded table name", async () => {
    const res = await handler(
      req("PATCH", "/user%20roles/1", { role: "superadmin" }),
    );
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.data.role).toBe("superadmin");
  });

  test("DELETE single resource with encoded table name", async () => {
    const res = await handler(req("DELETE", "/user%20roles/3"));
    expect(res.status).toBe(200);
  });
});

describe("single-resource method handling", () => {
  test("returns 405 for POST to /:table/:id", async () => {
    const res = await handler(req("POST", "/users/1"));
    expect(res.status).toBe(405);
  });
});

describe("method handling", () => {
  test("returns 405 for unsupported methods", async () => {
    const res = await handler(req("PUT", "/users"));
    expect(res.status).toBe(405);
  });
});
