import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { offerLink, offerSaveEnv, promptedPath } from "./create-next-steps.ts";

const LIBRARY = { Id: 12345, Name: "my-library", ApiKey: "secret-key" };
const cwd = process.cwd();
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stream-create-"));
  process.chdir(dir);
});

afterEach(() => process.chdir(cwd));

test("--save-env writes the library ID and API key the Stream examples read", async () => {
  expect(await offerSaveEnv(LIBRARY, true, "json")).toBe(true);
  expect(readFileSync(join(dir, ".env"), "utf-8")).toBe(
    "BUNNY_STREAM_LIBRARY_ID=12345\nBUNNY_STREAM_API_KEY=secret-key\n",
  );
});

test("--save-env replaces the values in the .env that already holds them", async () => {
  writeFileSync(join(dir, ".env"), "OTHER=1\nBUNNY_STREAM_LIBRARY_ID=1\n");
  mkdirSync(join(dir, "app"));
  process.chdir(join(dir, "app"));

  await offerSaveEnv(LIBRARY, true, "json");
  expect(readFileSync(join(dir, ".env"), "utf-8")).toBe(
    "OTHER=1\nBUNNY_STREAM_LIBRARY_ID=12345\nBUNNY_STREAM_API_KEY=secret-key\n",
  );
});

test("--no-save-env and --no-link write nothing", async () => {
  expect(await offerSaveEnv(LIBRARY, false, "json")).toBe(false);
  expect(await offerLink(LIBRARY, false, "json")).toBe(false);
  expect(() => readFileSync(join(dir, ".env"))).toThrow();
  expect(() => readFileSync(join(dir, ".bunny", "stream.json"))).toThrow();
});

test("--link points the directory at the new library", async () => {
  expect(await offerLink(LIBRARY, true, "json")).toBe(true);
  expect(
    JSON.parse(readFileSync(join(dir, ".bunny", "stream.json"), "utf-8")),
  ).toEqual({ id: 12345, name: "my-library" });
});

test("a dropped or typed path is unquoted, unescaped and has ~ expanded", () => {
  expect(promptedPath("/videos/My\\ Clip.mp4 ")).toBe("/videos/My Clip.mp4");
  expect(promptedPath("'/videos/My Clip.mp4'")).toBe("/videos/My Clip.mp4");
  expect(promptedPath("~/clip.mp4")).toBe(join(homedir(), "clip.mp4"));
});
