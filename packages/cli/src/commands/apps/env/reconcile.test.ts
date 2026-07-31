import { describe, expect, test } from "bun:test";
import type { BunnyAppConfig } from "../config.ts";
import {
  claimedEnvKeys,
  orphanEnvKeys,
  reconcileTarget,
  unclaimedEnvKeys,
} from "./reconcile.ts";

function config(containers: BunnyAppConfig["app"]["containers"]) {
  return {
    version: "1",
    app: { name: "orbit", regions: ["DE"], containers },
  } as BunnyAppConfig;
}

describe("claimedEnvKeys", () => {
  test("claims both the container key and the .env key it points at", () => {
    const claimed = claimedEnvKeys({
      env: { DATABASE_URL: "PROD_DATABASE_URL", PORT: "3000" },
    });
    expect([...claimed].sort()).toEqual([
      "3000",
      "DATABASE_URL",
      "PORT",
      "PROD_DATABASE_URL",
    ]);
  });

  test("is empty for a container with no env", () => {
    expect(claimedEnvKeys({ image: "nginx" }).size).toBe(0);
  });
});

describe("unclaimedEnvKeys", () => {
  test("returns keys the container neither sets nor points at", () => {
    expect(
      unclaimedEnvKeys(
        ["STRIPE_SECRET_KEY", "DATABASE_URL", "PROD_DATABASE_URL"],
        { env: { DATABASE_URL: "PROD_DATABASE_URL" } },
      ),
    ).toEqual(["STRIPE_SECRET_KEY"]);
  });

  test("drops previously declined keys", () => {
    expect(unclaimedEnvKeys(["A", "B", "C"], {}, ["B"])).toEqual(["A", "C"]);
  });

  test("sorts the result", () => {
    expect(unclaimedEnvKeys(["Z_VAR", "A_VAR"], {})).toEqual([
      "A_VAR",
      "Z_VAR",
    ]);
  });

  test("returns nothing when everything is claimed", () => {
    expect(unclaimedEnvKeys(["A"], { env: { A: "A" } })).toEqual([]);
  });
});

describe("reconcileTarget", () => {
  test("picks the only container when there's just one", () => {
    expect(reconcileTarget(config({ api: {} }))).toBe("api");
  });

  test("returns undefined for multiple containers without a flag", () => {
    expect(reconcileTarget(config({ api: {}, postgres: {} }))).toBeUndefined();
  });

  test("matches an explicit container case-insensitively", () => {
    expect(reconcileTarget(config({ api: {}, postgres: {} }), "API")).toBe(
      "api",
    );
  });

  test("returns undefined when the explicit container doesn't exist", () => {
    expect(reconcileTarget(config({ api: {} }), "worker")).toBeUndefined();
  });
});

describe("orphanEnvKeys", () => {
  test("only reports keys no container accounts for", () => {
    const toml = config({
      api: { env: { DATABASE_URL: "DATABASE_URL" } },
      postgres: { env: { POSTGRES_PASSWORD: "POSTGRES_PASSWORD" } },
    });
    expect(
      orphanEnvKeys(
        ["DATABASE_URL", "POSTGRES_PASSWORD", "STRIPE_SECRET_KEY"],
        toml,
      ),
    ).toEqual(["STRIPE_SECRET_KEY"]);
  });
});
