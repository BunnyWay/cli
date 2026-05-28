import { describe, expect, mock, test } from "bun:test";
import { resolveDeployRegistry } from "./deploy.ts";

describe("resolveDeployRegistry", () => {
  test("prefers the --registry flag over everything else", () => {
    const fallback = mock(() => "from-manifest");
    expect(resolveDeployRegistry("flag-reg", "draft-reg", fallback)).toBe(
      "flag-reg",
    );

    expect(fallback).not.toHaveBeenCalled();
  });

  test("uses the draft registry without consulting the manifest fallback", () => {
    const fallback = mock(() => undefined);
    expect(resolveDeployRegistry(undefined, "draft-reg", fallback)).toBe(
      "draft-reg",
    );
    expect(fallback).not.toHaveBeenCalled();
  });

  test("falls back to the manifest only when flag and draft are both unset", () => {
    const fallback = mock(() => "from-manifest");
    expect(resolveDeployRegistry(undefined, undefined, fallback)).toBe(
      "from-manifest",
    );
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  test("returns undefined when no source supplies a registry", () => {
    expect(resolveDeployRegistry(undefined, undefined, () => undefined)).toBe(
      undefined,
    );
  });
});
