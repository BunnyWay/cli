import { describe, expect, test } from "bun:test";
import { parseRegistrar } from "./registrar.ts";

describe("parseRegistrar", () => {
  const vcard = (fn: string) => ({
    roles: ["registrar"],
    vcardArray: [
      "vcard",
      [
        ["version", {}, "text", "4.0"],
        ["fn", {}, "text", fn],
      ],
    ],
  });

  test("reads the registrar entity's display name", () => {
    expect(parseRegistrar({ entities: [vcard("Namecheap, Inc.")] })).toBe(
      "Namecheap",
    );
  });

  test("strips assorted legal suffixes", () => {
    expect(parseRegistrar({ entities: [vcard("NameCheap Inc.")] })).toBe(
      "NameCheap",
    );
    expect(parseRegistrar({ entities: [vcard("GoDaddy.com, LLC")] })).toBe(
      "GoDaddy.com",
    );
  });

  test("ignores entities that aren't the registrar", () => {
    const data = {
      entities: [
        {
          roles: ["technical"],
          vcardArray: ["vcard", [["fn", {}, "text", "Tech Co."]]],
        },
      ],
    };
    expect(parseRegistrar(data)).toBeNull();
  });

  test("returns null when there are no entities", () => {
    expect(parseRegistrar({})).toBeNull();
  });
});
