import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CURRENT_VERSION } from "@bunny.net/app-config";
import { useTempDir } from "../../../test-utils/temp-dir.ts";
import type { BunnyAppConfig } from "../config.ts";
import { resolveContainerEnv } from "./resolve.ts";

const tempDir = useTempDir("bunny-env-resolve-");

function makeConfig(env: Record<string, string>): BunnyAppConfig {
  return {
    version: CURRENT_VERSION,
    app: {
      name: "x",
      containers: { api: { image: "nginx", env } },
    },
  };
}

describe("resolveContainerEnv", () => {
  test("resolves values that match a key in .env", () => {
    const dotenv = join(tempDir(), ".env");
    writeFileSync(dotenv, "BETTER_AUTH_SECRET=topsecret\n");

    const resolved = resolveContainerEnv(
      makeConfig({ BETTER_AUTH_SECRET: "BETTER_AUTH_SECRET" }),
      dotenv,
    );

    expect(resolved.app.containers.api?.env).toEqual({
      BETTER_AUTH_SECRET: "topsecret",
    });
  });

  test("passes literal values through unchanged when no key matches", () => {
    const dotenv = join(tempDir(), ".env");
    writeFileSync(dotenv, "OTHER=x\n");

    const resolved = resolveContainerEnv(
      makeConfig({ POSTGRES_DB: "orbit", PORT: "3000" }),
      dotenv,
    );

    expect(resolved.app.containers.api?.env).toEqual({
      POSTGRES_DB: "orbit",
      PORT: "3000",
    });
  });

  test("supports renaming: LHS is container key, RHS is .env key", () => {
    const dotenv = join(tempDir(), ".env");
    writeFileSync(dotenv, "PROD_DATABASE_URL=postgres://prod/db\n");

    const resolved = resolveContainerEnv(
      makeConfig({ DATABASE_URL: "PROD_DATABASE_URL" }),
      dotenv,
    );

    expect(resolved.app.containers.api?.env).toEqual({
      DATABASE_URL: "postgres://prod/db",
    });
  });

  test("missing .env file leaves all values literal", () => {
    const resolved = resolveContainerEnv(
      makeConfig({ POSTGRES_DB: "orbit", BETTER_AUTH_SECRET: "secret" }),
      join(tempDir(), ".env"),
    );

    expect(resolved.app.containers.api?.env).toEqual({
      POSTGRES_DB: "orbit",
      BETTER_AUTH_SECRET: "secret",
    });
  });

  test("does not mutate the input config", () => {
    const dotenv = join(tempDir(), ".env");
    writeFileSync(dotenv, "BETTER_AUTH_SECRET=topsecret\n");

    const input = makeConfig({ BETTER_AUTH_SECRET: "BETTER_AUTH_SECRET" });
    resolveContainerEnv(input, dotenv);

    // Original config still carries the pointer, not the resolved value.
    expect(input.app.containers.api?.env).toEqual({
      BETTER_AUTH_SECRET: "BETTER_AUTH_SECRET",
    });
  });

  test("mixes literals and pointers in the same env block", () => {
    const dotenv = join(tempDir(), ".env");
    writeFileSync(dotenv, "BETTER_AUTH_SECRET=topsecret\nDATABASE_URL=pgurl\n");

    const resolved = resolveContainerEnv(
      makeConfig({
        POSTGRES_DB: "orbit",
        BETTER_AUTH_SECRET: "BETTER_AUTH_SECRET",
        DATABASE_URL: "DATABASE_URL",
      }),
      dotenv,
    );

    expect(resolved.app.containers.api?.env).toEqual({
      POSTGRES_DB: "orbit",
      BETTER_AUTH_SECRET: "topsecret",
      DATABASE_URL: "pgurl",
    });
  });

  test("containers without env are left untouched", () => {
    const dotenv = join(tempDir(), ".env");
    writeFileSync(dotenv, "FOO=bar\n");

    const input: BunnyAppConfig = {
      version: CURRENT_VERSION,
      app: {
        name: "x",
        containers: { api: { image: "nginx" } },
      },
    };

    const resolved = resolveContainerEnv(input, dotenv);
    expect(resolved.app.containers.api?.env).toBeUndefined();
  });
});
