import { describe, expect, test } from "bun:test";
import { ApiError, UserError } from "./errors.ts";

describe("UserError", () => {
  test("is an Error with the UserError name and isUserError flag", () => {
    const err = new UserError("something you can fix");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("UserError");
    expect(err.message).toBe("something you can fix");
    expect(err.isUserError).toBe(true);
    expect(err.hint).toBeUndefined();
  });

  test("carries an optional hint", () => {
    const err = new UserError("missing config", "run `bunny config init`");
    expect(err.hint).toBe("run `bunny config init`");
  });
});

describe("ApiError", () => {
  test("extends UserError so handlers can treat it as user-facing", () => {
    const err = new ApiError("Not found.", 404);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(UserError);
    expect(err).toBeInstanceOf(Error);
    expect(err.isUserError).toBe(true);
    expect(err.name).toBe("ApiError");
  });
});
