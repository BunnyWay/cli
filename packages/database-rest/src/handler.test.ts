import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import type { DatabaseSchema } from "@bunny.net/database-openapi";
import { createRestHandler } from "./handler.ts";
import { introspect } from "./introspect.ts";

let client: Client;
let schema: DatabaseSchema;
let handler: (req: Request) => Promise<Response>;

beforeAll(async () => {
  client = createClient({ url: ":memory:" });

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
  `);

  schema = await introspect({ client });
  handler = createRestHandler(client, schema);
});

afterAll(() => {
  client.close();
});

function req(method: string, path: string, body?: unknown): Request {
  const url = `http://localhost${path}`;
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jsonBody(res: Response): Promise<any> {
  return res.json();
}

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
    // Insert a row to delete
    await handler(
      req("POST", "/users", { name: "ToDelete", email: "del@example.com" }),
    );

    const res = await handler(req("DELETE", "/users?name=eq.ToDelete"));
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("ToDelete");

    // Verify it's gone
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

describe("basePath option", () => {
  test("strips base path before routing", async () => {
    const apiHandler = createRestHandler(client, schema, { basePath: "/api" });

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
    const apiHandler = createRestHandler(client, schema, { basePath: "/api" });

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
    // Single object, not array
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
    // Insert a row to delete
    await handler(
      req("POST", "/users", { name: "Temp", email: "temp@example.com" }),
    );

    // Find the row
    const findRes = await handler(req("GET", "/users?name=eq.Temp"));
    const findBody = await jsonBody(findRes);
    const id = findBody.data[0].id;

    const res = await handler(req("DELETE", `/users/${id}`));
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.data.name).toBe("Temp");
    expect(Array.isArray(body.data)).toBe(false);

    // Verify it's gone
    const check = await handler(req("GET", `/users/${id}`));
    expect(check.status).toBe(404);
  });

  test("returns 404 for non-existent row", async () => {
    const res = await handler(req("DELETE", "/users/9999"));
    expect(res.status).toBe(404);
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
