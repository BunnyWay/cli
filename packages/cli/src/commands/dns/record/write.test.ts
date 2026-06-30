import { describe, expect, test } from "bun:test";
import { reviewAndApply, writeRecords } from "./write.ts";

const zone = { Id: 1, Domain: "example.com" } as never;

describe("writeRecords", () => {
  test("keeps going after a failure and reports both sides", async () => {
    const client = {
      PUT: async (_path: string, opts: { body: { Value?: string | null } }) => {
        if (opts.body.Value === "bad")
          throw new Error("A tag can be a maximum of 50 characters.");
        return {};
      },
    } as never;

    const result = await writeRecords(client, zone, [
      { Value: "ok-1" },
      { Value: "bad" },
      { Value: "ok-2" },
    ] as never);

    expect(result.applied).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.message).toContain("maximum of 50 characters");
    expect(result.failures[0]?.record.Value).toBe("bad");
  });
});

describe("reviewAndApply", () => {
  test("a json run throws (nonzero exit) when every record fails", async () => {
    const client = {
      PUT: async () => {
        throw new Error("boom");
      },
    } as never;

    await expect(
      reviewAndApply({
        client,
        zone,
        records: [{ Value: "x" }] as never,
        output: "json",
        selectMessage: "",
        spinnerLabel: "",
        successFor: () => "",
      }),
    ).rejects.toThrow(/None of the/);
  });
});
