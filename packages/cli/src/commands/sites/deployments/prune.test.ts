import { expect, test } from "bun:test";
import { type DeployRecord, pruneVictims } from "@/commands/sites/constants.ts";
import { resolveKeepCount } from "./prune.ts";

function deploy(id: string, createdAt: string): DeployRecord {
  return {
    id,
    createdAt,
    source: "content",
    contentHash: `hash-${id}`,
    files: 1,
    bytes: 1,
  };
}

const DEPLOYS = [
  deploy("aaa", "2026-07-01T00:00:00Z"),
  deploy("bbb", "2026-07-02T00:00:00Z"),
  deploy("ccc", "2026-07-03T00:00:00Z"),
  deploy("ddd", "2026-07-04T00:00:00Z"),
];

test("pruneVictims drops everything beyond the newest N", () => {
  const victims = pruneVictims(DEPLOYS, 2);
  expect(victims.map((v) => v.id)).toEqual(["bbb", "aaa"]);
});

test("pruneVictims never touches current or previous", () => {
  const victims = pruneVictims(DEPLOYS, 1, "aaa", "bbb");
  expect(victims.map((v) => v.id)).toEqual(["ccc"]);
});

// `--keep abc` arrives as NaN; unchecked it would prune every deploy but current/previous.
test("resolveKeepCount rejects NaN, negatives, and fractions", () => {
  expect(() => resolveKeepCount(Number.NaN)).toThrow("--keep must be");
  expect(() => resolveKeepCount(-1)).toThrow("--keep must be");
  expect(() => resolveKeepCount(2.5)).toThrow("--keep must be");
});
