import { z } from "zod";
import type { Action } from "../../define-action.ts";
import { defineAction } from "../../define-action.ts";
import { fetchDatabase, generateToken } from "./api.ts";

const databaseRef = z
  .string()
  .min(1)
  .describe("Database ID, e.g. `db_01KCHBG8C5KSFGG0VRNFQ7EK7X`.");

export const DatabaseTokenSchema = z.object({
  database: z.string(),
  token: z.string(),
  authorization: z.enum(["full-access", "read-only"]),
  expiresAt: z
    .string()
    .nullable()
    .describe("RFC 3339 expiry, or null when the token never expires."),
  databaseUrl: z
    .string()
    .describe(
      "The database connection URL, so a caller can save both together.",
    ),
});

export type DatabaseToken = z.infer<typeof DatabaseTokenSchema>;

export const dbTokensCreate = defineAction({
  name: "db.tokens.create",
  title: "Create a database token",
  description:
    "Generate an auth token for a database. Full-access by default; pass readOnly for a read-only token. The token is shown once and cannot be retrieved again.",
  schema: z.strictObject({
    database: databaseRef,
    readOnly: z
      .boolean()
      .default(false)
      .describe("Generate a read-only token instead of full-access."),
    expiresAt: z
      .string()
      .nullable()
      .default(null)
      .describe(
        "RFC 3339 expiry timestamp. Null means the token never expires.",
      ),
  }),
  kind: "write",
  resultSchema: DatabaseTokenSchema,
  sensitive: true,
  examples: [
    [{ database: "db_01KCH" }, "A full-access token that never expires"],
    [{ database: "db_01KCH", readOnly: true }, "A read-only token"],
  ],
  run: async (ctx, input): Promise<DatabaseToken> => {
    const authorization = input.readOnly ? "read-only" : "full-access";

    ctx.progress("Generating token...");
    const [tokenResult, db] = await Promise.all([
      generateToken(ctx.clients.db, input.database, {
        authorization,
        expiresAt: input.expiresAt,
      }),
      fetchDatabase(ctx.clients.db, input.database, { signal: ctx.signal }),
    ]);

    return {
      database: input.database,
      token: tokenResult?.token ?? "",
      authorization,
      expiresAt: tokenResult?.expires_at ?? null,
      databaseUrl: db.url,
    };
  },
});

export const InvalidatedTokensSchema = z.object({
  database: z.string(),
  invalidated: z.literal(true),
});

export type InvalidatedTokens = z.infer<typeof InvalidatedTokensSchema>;

export const dbTokensInvalidate = defineAction({
  name: "db.tokens.invalidate",
  title: "Invalidate database tokens",
  description:
    "Revoke every auth token for a database at once. Existing connections using those tokens stop working immediately.",
  schema: z.strictObject({ database: databaseRef }),
  kind: "destructive",
  resultSchema: InvalidatedTokensSchema,
  examples: [[{ database: "db_01KCH" }, "Revoke all tokens for a database"]],
  run: async (ctx, input): Promise<InvalidatedTokens> => {
    ctx.progress("Revoking tokens...");
    await ctx.clients.db.POST("/v2/databases/{db_id}/auth/revoke", {
      params: { path: { db_id: input.database } },
      signal: ctx.signal,
    });
    return { database: input.database, invalidated: true };
  },
});

export const dbTokenActions: Action[] = [dbTokensCreate, dbTokensInvalidate];
