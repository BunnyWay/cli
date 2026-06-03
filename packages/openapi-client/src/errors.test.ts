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

  test("records status and leaves optional fields undefined", () => {
    const err = new ApiError("Unauthorized.", 401);
    expect(err.status).toBe(401);
    expect(err.field).toBeUndefined();
    expect(err.validationErrors).toBeUndefined();
  });

  test("records field and validation errors when provided", () => {
    const validationErrors = [{ field: "Name", message: "is required" }];
    const err = new ApiError(
      "Validation failed.",
      422,
      "Name",
      validationErrors,
    );
    expect(err.status).toBe(422);
    expect(err.field).toBe("Name");
    expect(err.validationErrors).toEqual(validationErrors);
  });
});
