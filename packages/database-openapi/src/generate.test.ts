import { describe, expect, test } from "bun:test";
import { Validator } from "@seriousme/openapi-schema-validator";
import { generateOpenAPISpec } from "./generate.ts";
import type { DatabaseSchema } from "./types.ts";

const usersTable = {
  name: "users",
  columns: [
    { name: "id", type: "INTEGER" as const, nullable: false, primaryKey: true },
    { name: "name", type: "TEXT" as const, nullable: false, primaryKey: false },
    { name: "email", type: "TEXT" as const, nullable: false, primaryKey: false },
    { name: "age", type: "INTEGER" as const, nullable: true, primaryKey: false },
    { name: "created_at", type: "DATETIME" as const, nullable: false, primaryKey: false, defaultValue: "CURRENT_TIMESTAMP" },
  ],
  primaryKey: ["id"],
  foreignKeys: [],
};

const postsTable = {
  name: "posts",
  columns: [
    { name: "id", type: "INTEGER" as const, nullable: false, primaryKey: true },
    { name: "title", type: "TEXT" as const, nullable: false, primaryKey: false },
    { name: "body", type: "TEXT" as const, nullable: true, primaryKey: false },
    { name: "user_id", type: "INTEGER" as const, nullable: false, primaryKey: false },
    { name: "published", type: "BOOLEAN" as const, nullable: false, primaryKey: false, defaultValue: 0 },
  ],
  primaryKey: ["id"],
  foreignKeys: [
    { column: "user_id", referencesTable: "users", referencesColumn: "id" },
  ],
};

const schema: DatabaseSchema = {
  tables: {
    users: usersTable,
    posts: postsTable,
  },
  version: "1.0.0",
};

describe("generateOpenAPISpec", () => {
  test("returns valid OpenAPI 3.0.3 structure", () => {
    const spec = generateOpenAPISpec(schema);

    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.version).toBe("1.0.0");
    expect(spec.paths).toBeDefined();
    expect(spec.components.schemas).toBeDefined();
    expect(spec.components.parameters).toBeDefined();
  });

  test("uses custom options for info", () => {
    const spec = generateOpenAPISpec(schema, {
      title: "My API",
      version: "2.0.0",
      description: "Custom description",
    });

    expect(spec.info.title).toBe("My API");
    expect(spec.info.version).toBe("2.0.0");
    expect(spec.info.description).toBe("Custom description");
  });

  test("uses defaults when no options provided", () => {
    const spec = generateOpenAPISpec(schema);

    expect(spec.info.title).toBe("Database REST API");
    expect(spec.info.version).toBe("1.0.0");
  });

  test("generates collection and single-resource paths per table", () => {
    const spec = generateOpenAPISpec(schema);

    expect(spec.paths["/users"]).toBeDefined();
    expect(spec.paths["/users/{id}"]).toBeDefined();
    expect(spec.paths["/posts"]).toBeDefined();
    expect(spec.paths["/posts/{id}"]).toBeDefined();
    expect(Object.keys(spec.paths)).toHaveLength(4);
  });

  test("generates GET, POST, PATCH, DELETE for each table", () => {
    const spec = generateOpenAPISpec(schema);
    const usersPath = spec.paths["/users"]!;

    expect(usersPath.get).toBeDefined();
    expect(usersPath.post).toBeDefined();
    expect(usersPath.patch).toBeDefined();
    expect(usersPath.delete).toBeDefined();
  });

  test("GET uses $ref for common params and inline filter params", () => {
    const spec = generateOpenAPISpec(schema);
    const get = spec.paths["/users"]!.get!;
    const params = get.parameters!;

    // First 4 are $ref to common parameters
    expect(params[0]).toEqual({ $ref: "#/components/parameters/select" });
    expect(params[1]).toEqual({ $ref: "#/components/parameters/order" });
    expect(params[2]).toEqual({ $ref: "#/components/parameters/limit" });
    expect(params[3]).toEqual({ $ref: "#/components/parameters/offset" });

    // Remaining are inline filter params for each column
    const filterParams = params.slice(4) as { name: string }[];
    const filterNames = filterParams.map((p) => p.name);
    expect(filterNames).toContain("id");
    expect(filterNames).toContain("name");
    expect(filterNames).toContain("email");
    expect(filterNames).toContain("age");
    expect(filterNames).toContain("created_at");
  });

  test("POST accepts single or array insert", () => {
    const spec = generateOpenAPISpec(schema);
    const post = spec.paths["/users"]!.post!;
    const bodySchema = post.requestBody!.content["application/json"].schema;

    expect(bodySchema.oneOf).toHaveLength(2);
    expect(bodySchema.oneOf![0]!.$ref).toBe("#/components/schemas/usersInsert");
    expect(bodySchema.oneOf![1]!.type).toBe("array");
  });

  test("generates three schema variants per table", () => {
    const spec = generateOpenAPISpec(schema);

    expect(spec.components.schemas["users"]).toBeDefined();
    expect(spec.components.schemas["usersInsert"]).toBeDefined();
    expect(spec.components.schemas["usersUpdate"]).toBeDefined();
    expect(spec.components.schemas["posts"]).toBeDefined();
    expect(spec.components.schemas["postsInsert"]).toBeDefined();
    expect(spec.components.schemas["postsUpdate"]).toBeDefined();
  });

  test("base schema includes all columns with examples", () => {
    const spec = generateOpenAPISpec(schema);
    const usersSchema = spec.components.schemas["users"]!;

    expect(usersSchema.properties!["id"]).toEqual({ type: "integer", example: 1 });
    expect(usersSchema.properties!["name"]).toEqual({ type: "string", example: "John Doe" });
    expect(usersSchema.properties!["email"]).toEqual({ type: "string", example: "user@example.com" });
    expect(usersSchema.properties!["age"]).toEqual({ type: "integer", nullable: true, example: 25 });
    expect(usersSchema.properties!["created_at"]).toEqual({ type: "string", format: "date-time", example: "2024-01-01T00:00:00Z" });
  });

  test("base schema required excludes PKs, nullable, and columns with defaults", () => {
    const spec = generateOpenAPISpec(schema);
    const usersSchema = spec.components.schemas["users"]!;

    // name and email are required (not nullable, no default, not PK)
    expect(usersSchema.required).toContain("name");
    expect(usersSchema.required).toContain("email");
    // id is PK, age is nullable, created_at has a default
    expect(usersSchema.required).not.toContain("id");
    expect(usersSchema.required).not.toContain("age");
    expect(usersSchema.required).not.toContain("created_at");
  });

  test("insert schema skips auto-increment INTEGER PKs", () => {
    const spec = generateOpenAPISpec(schema);
    const insertSchema = spec.components.schemas["usersInsert"]!;

    expect(insertSchema.properties!["id"]).toBeUndefined();
    expect(insertSchema.properties!["name"]).toBeDefined();
    expect(insertSchema.properties!["email"]).toBeDefined();
  });

  test("insert schema marks non-nullable columns without defaults as required", () => {
    const spec = generateOpenAPISpec(schema);
    const insertSchema = spec.components.schemas["usersInsert"]!;

    expect(insertSchema.required).toContain("name");
    expect(insertSchema.required).toContain("email");
    expect(insertSchema.required).not.toContain("created_at");
  });

  test("update schema excludes PKs and has no required fields", () => {
    const spec = generateOpenAPISpec(schema);
    const updateSchema = spec.components.schemas["usersUpdate"]!;

    expect(updateSchema.properties!["id"]).toBeUndefined();
    expect(updateSchema.properties!["name"]).toBeDefined();
    expect(updateSchema.required).toBeUndefined();
  });

  test("maps column types correctly with examples", () => {
    const spec = generateOpenAPISpec(schema);
    const postsSchema = spec.components.schemas["posts"]!;

    expect(postsSchema.properties!["id"]).toEqual({ type: "integer", example: 1 });
    expect(postsSchema.properties!["title"]).toEqual({ type: "string", example: "Hello World" });
    expect(postsSchema.properties!["body"]).toEqual({ type: "string", nullable: true, example: "Lorem ipsum dolor sit amet" });
    expect(postsSchema.properties!["published"]).toEqual({ type: "boolean", example: true });
  });

  test("maps REAL to number with double format", () => {
    const realSchema: DatabaseSchema = {
      tables: {
        measurements: {
          name: "measurements",
          columns: [
            { name: "id", type: "INTEGER", nullable: false, primaryKey: true },
            { name: "value", type: "REAL", nullable: false, primaryKey: false },
          ],
          primaryKey: ["id"],
          foreignKeys: [],
        },
      },
      version: "1.0.0",
    };

    const spec = generateOpenAPISpec(realSchema);
    expect(spec.components.schemas["measurements"]!.properties!["value"]).toEqual({
      type: "number",
      format: "double",
      example: 1.5,
    });
  });

  test("maps BLOB to string with binary format without example", () => {
    const blobSchema: DatabaseSchema = {
      tables: {
        files: {
          name: "files",
          columns: [
            { name: "id", type: "INTEGER", nullable: false, primaryKey: true },
            { name: "data", type: "BLOB", nullable: false, primaryKey: false },
          ],
          primaryKey: ["id"],
          foreignKeys: [],
        },
      },
      version: "1.0.0",
    };

    const spec = generateOpenAPISpec(blobSchema);
    expect(spec.components.schemas["files"]!.properties!["data"]).toEqual({
      type: "string",
      format: "binary",
    });
  });

  test("empty schema produces empty paths and only Error schema", () => {
    const emptySchema: DatabaseSchema = {
      tables: {},
      version: "1.0.0",
    };

    const spec = generateOpenAPISpec(emptySchema);
    expect(Object.keys(spec.paths)).toHaveLength(0);
    expect(Object.keys(spec.components.schemas)).toEqual(["Error"]);
    expect(spec.tags).toBeUndefined();
  });

  test("operationIds are capitalized table names", () => {
    const spec = generateOpenAPISpec(schema);

    expect(spec.paths["/users"]!.get!.operationId).toBe("getUsers");
    expect(spec.paths["/users"]!.post!.operationId).toBe("createUsers");
    expect(spec.paths["/users"]!.patch!.operationId).toBe("updateUsers");
    expect(spec.paths["/users"]!.delete!.operationId).toBe("deleteUsers");
  });

  test("operation tags match table names", () => {
    const spec = generateOpenAPISpec(schema);

    expect(spec.paths["/users"]!.get!.tags).toEqual(["users"]);
    expect(spec.paths["/posts"]!.post!.tags).toEqual(["posts"]);
  });

  test("single-resource path has GET, PATCH, DELETE but no POST", () => {
    const spec = generateOpenAPISpec(schema);
    const userById = spec.paths["/users/{id}"]!;

    expect(userById.get).toBeDefined();
    expect(userById.patch).toBeDefined();
    expect(userById.delete).toBeDefined();
    expect(userById.post).toBeUndefined();
  });

  test("single-resource GET has path param and select $ref", () => {
    const spec = generateOpenAPISpec(schema);
    const get = spec.paths["/users/{id}"]!.get!;

    expect(get.parameters).toHaveLength(2);
    const pathParam = get.parameters![0] as { name: string; in: string; required: boolean };
    expect(pathParam.name).toBe("id");
    expect(pathParam.in).toBe("path");
    expect(pathParam.required).toBe(true);
    expect(get.parameters![1]).toEqual({ $ref: "#/components/parameters/select" });
  });

  test("single-resource PATCH has path param and request body", () => {
    const spec = generateOpenAPISpec(schema);
    const patch = spec.paths["/users/{id}"]!.patch!;

    expect(patch.parameters).toHaveLength(1);
    const pathParam = patch.parameters![0] as { name: string; in: string };
    expect(pathParam.name).toBe("id");
    expect(pathParam.in).toBe("path");
    expect(patch.requestBody).toBeDefined();
  });

  test("single-resource DELETE has only path param", () => {
    const spec = generateOpenAPISpec(schema);
    const del = spec.paths["/users/{id}"]!.delete!;

    expect(del.parameters).toHaveLength(1);
    const pathParam = del.parameters![0] as { name: string; in: string };
    expect(pathParam.name).toBe("id");
    expect(pathParam.in).toBe("path");
  });

  test("single-resource responses return single object, not array", () => {
    const spec = generateOpenAPISpec(schema);
    const get = spec.paths["/users/{id}"]!.get!;
    const dataSchema = get.responses["200"]!.content!["application/json"].schema;

    expect(dataSchema.properties!["data"]!.$ref).toBe("#/components/schemas/users");
    expect(dataSchema.properties!["data"]!.type).toBeUndefined();
  });

  test("single-resource operationIds include PK name", () => {
    const spec = generateOpenAPISpec(schema);
    const userById = spec.paths["/users/{id}"]!;

    expect(userById.get!.operationId).toBe("getUsersById");
    expect(userById.patch!.operationId).toBe("updateUsersById");
    expect(userById.delete!.operationId).toBe("deleteUsersById");
  });

  test("skips single-resource path for tables without PK", () => {
    const noPkSchema: DatabaseSchema = {
      tables: {
        logs: {
          name: "logs",
          columns: [
            { name: "message", type: "TEXT", nullable: false, primaryKey: false },
            { name: "level", type: "TEXT", nullable: false, primaryKey: false },
          ],
          primaryKey: [],
          foreignKeys: [],
        },
      },
      version: "1.0.0",
    };

    const spec = generateOpenAPISpec(noPkSchema);
    expect(spec.paths["/logs"]).toBeDefined();
    expect(spec.paths["/logs/{message}"]).toBeUndefined();
    expect(Object.keys(spec.paths)).toHaveLength(1);
  });

  test("skips single-resource path for composite PKs", () => {
    const compositePkSchema: DatabaseSchema = {
      tables: {
        user_roles: {
          name: "user_roles",
          columns: [
            { name: "user_id", type: "INTEGER", nullable: false, primaryKey: true },
            { name: "role_id", type: "INTEGER", nullable: false, primaryKey: true },
          ],
          primaryKey: ["user_id", "role_id"],
          foreignKeys: [],
        },
      },
      version: "1.0.0",
    };

    const spec = generateOpenAPISpec(compositePkSchema);
    expect(spec.paths["/user_roles"]).toBeDefined();
    expect(Object.keys(spec.paths)).toHaveLength(1);
  });

  test("includes Error schema in components", () => {
    const spec = generateOpenAPISpec(schema);
    const errorSchema = spec.components.schemas["Error"]!;

    expect(errorSchema.type).toBe("object");
    expect(errorSchema.properties!["message"]).toEqual({ type: "string", example: "Something went wrong" });
    expect(errorSchema.properties!["code"]).toEqual({ type: "string", example: "BAD_REQUEST" });
    expect(errorSchema.required).toEqual(["message"]);
  });

  test("GET responses include 400 and 404 errors", () => {
    const spec = generateOpenAPISpec(schema);
    const get = spec.paths["/users"]!.get!;

    expect(get.responses["400"]).toBeDefined();
    expect(get.responses["400"]!.description).toBe("Bad request");
    expect(get.responses["404"]).toBeDefined();
    expect(get.responses["404"]!.description).toBe("Not found");
  });

  test("POST responses include 400 but not 404", () => {
    const spec = generateOpenAPISpec(schema);
    const post = spec.paths["/users"]!.post!;

    expect(post.responses["400"]).toBeDefined();
    expect(post.responses["404"]).toBeUndefined();
  });

  test("PATCH and DELETE responses include 400 and 404 errors", () => {
    const spec = generateOpenAPISpec(schema);
    const patch = spec.paths["/users"]!.patch!;
    const del = spec.paths["/users"]!.delete!;

    expect(patch.responses["400"]).toBeDefined();
    expect(patch.responses["404"]).toBeDefined();
    expect(del.responses["400"]).toBeDefined();
    expect(del.responses["404"]).toBeDefined();
  });

  test("error responses reference the Error schema", () => {
    const spec = generateOpenAPISpec(schema);
    const get = spec.paths["/users"]!.get!;
    const errorContent = get.responses["400"]!.content!["application/json"].schema;

    expect(errorContent.$ref).toBe("#/components/schemas/Error");
  });

  test("top-level tags are defined with descriptions", () => {
    const spec = generateOpenAPISpec(schema);

    expect(spec.tags).toEqual([
      { name: "users", description: "Operations on users" },
      { name: "posts", description: "Operations on posts" },
    ]);
  });

  test("produces a valid OpenAPI 3.0 spec", async () => {
    const spec = generateOpenAPISpec(schema);
    const validator = new Validator();
    const result = await validator.validate(spec as unknown as Record<string, unknown>);

    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  test("produces a valid spec with empty schema", async () => {
    const emptySchema: DatabaseSchema = {
      tables: {},
      version: "1.0.0",
    };

    const spec = generateOpenAPISpec(emptySchema);
    const validator = new Validator();
    const result = await validator.validate(spec as unknown as Record<string, unknown>);

    expect(result.valid).toBe(true);
  });

  test("name-aware examples for common column names", () => {
    const namedSchema: DatabaseSchema = {
      tables: {
        profiles: {
          name: "profiles",
          columns: [
            { name: "id", type: "INTEGER", nullable: false, primaryKey: true },
            { name: "email", type: "TEXT", nullable: false, primaryKey: false },
            { name: "username", type: "TEXT", nullable: false, primaryKey: false },
            { name: "first_name", type: "TEXT", nullable: false, primaryKey: false },
            { name: "last_name", type: "TEXT", nullable: false, primaryKey: false },
            { name: "phone", type: "TEXT", nullable: true, primaryKey: false },
            { name: "avatar_url", type: "TEXT", nullable: true, primaryKey: false },
            { name: "bio", type: "TEXT", nullable: true, primaryKey: false },
            { name: "city", type: "TEXT", nullable: true, primaryKey: false },
            { name: "country", type: "TEXT", nullable: true, primaryKey: false },
            { name: "latitude", type: "REAL", nullable: true, primaryKey: false },
            { name: "longitude", type: "REAL", nullable: true, primaryKey: false },
            { name: "price", type: "REAL", nullable: true, primaryKey: false },
            { name: "slug", type: "TEXT", nullable: false, primaryKey: false },
            { name: "team_id", type: "INTEGER", nullable: false, primaryKey: false },
            { name: "updated_at", type: "DATETIME", nullable: false, primaryKey: false },
          ],
          primaryKey: ["id"],
          foreignKeys: [],
        },
      },
      version: "1.0.0",
    };

    const spec = generateOpenAPISpec(namedSchema);
    const props = spec.components.schemas["profiles"]!.properties!;

    expect(props["email"]!.example).toBe("user@example.com");
    expect(props["username"]!.example).toBe("johndoe");
    expect(props["first_name"]!.example).toBe("John");
    expect(props["last_name"]!.example).toBe("Doe");
    expect(props["phone"]!.example).toBe("+1-555-0123");
    expect(props["avatar_url"]!.example).toBe("https://example.com/image.png");
    expect(props["bio"]!.example).toBe("A short description");
    expect(props["city"]!.example).toBe("San Francisco");
    expect(props["country"]!.example).toBe("US");
    expect(props["latitude"]!.example).toBe(37.7749);
    expect(props["longitude"]!.example).toBe(-122.4194);
    expect(props["price"]!.example).toBe(9.99);
    expect(props["slug"]!.example).toBe("hello-world");
    expect(props["team_id"]!.example).toBe(1);
    expect(props["updated_at"]!.example).toBe("2024-01-01T00:00:00Z");
  });

  test("type-based fallback examples for unknown column names", () => {
    const unknownSchema: DatabaseSchema = {
      tables: {
        things: {
          name: "things",
          columns: [
            { name: "id", type: "INTEGER", nullable: false, primaryKey: true },
            { name: "foo", type: "TEXT", nullable: false, primaryKey: false },
            { name: "bar", type: "INTEGER", nullable: false, primaryKey: false },
            { name: "baz", type: "REAL", nullable: false, primaryKey: false },
            { name: "qux", type: "BOOLEAN", nullable: false, primaryKey: false },
            { name: "quux", type: "DATETIME", nullable: false, primaryKey: false },
            { name: "corge", type: "BLOB", nullable: false, primaryKey: false },
          ],
          primaryKey: ["id"],
          foreignKeys: [],
        },
      },
      version: "1.0.0",
    };

    const spec = generateOpenAPISpec(unknownSchema);
    const props = spec.components.schemas["things"]!.properties!;

    expect(props["foo"]!.example).toBe("string");
    expect(props["bar"]!.example).toBe(1);
    expect(props["baz"]!.example).toBe(1.5);
    expect(props["qux"]!.example).toBe(true);
    expect(props["quux"]!.example).toBe("2024-01-01T00:00:00Z");
    expect(props["corge"]!.example).toBeUndefined();
  });

  test("PATCH and DELETE have only filter params, no common param $refs", () => {
    const spec = generateOpenAPISpec(schema);
    const patch = spec.paths["/users"]!.patch!;
    const del = spec.paths["/users"]!.delete!;

    // All params are inline filter params (no $ref objects)
    for (const p of patch.parameters!) {
      expect("$ref" in p).toBe(false);
      expect((p as { name: string }).name).toBeDefined();
    }
    for (const p of del.parameters!) {
      expect("$ref" in p).toBe(false);
      expect((p as { name: string }).name).toBeDefined();
    }

    // Has column filter params
    const patchNames = patch.parameters!.map((p) => (p as { name: string }).name);
    const deleteNames = del.parameters!.map((p) => (p as { name: string }).name);
    expect(patchNames).toContain("id");
    expect(deleteNames).toContain("id");
  });
});
