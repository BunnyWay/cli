import { expect, test } from "bun:test";
import { type DeployRecord, pruneVictims } from "../constants.ts";

function deploy(id: string, createdAt: string): DeployRecord {
  return { id, createdAt, source: "content", files: 1, bytes: 1 };
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

test("pruneVictims is empty when everything fits", () => {
  expect(pruneVictims(DEPLOYS, 10)).toEqual([]);
  expect(pruneVictims([], 0)).toEqual([]);
});
