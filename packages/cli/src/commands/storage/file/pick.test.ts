import { describe, expect, mock, test } from "bun:test";
import type { StorageFile } from "../files-api.ts";

const listFiles = mock<(zone: unknown, dir: string) => Promise<StorageFile[]>>(
  async () => [],
);

mock.module("../files-api.ts", () => ({ listFiles }));

const { promptStoragePath } = await import("./pick.ts");
const prompts = (await import("prompts")).default;

function entry(objectName: string, isDirectory: boolean): StorageFile {
  return { objectName, isDirectory, length: 10 } as StorageFile;
}

// Each directory listing the picker will walk, keyed by the directory it asks for.
function tree(dirs: Record<string, StorageFile[]>): void {
  listFiles.mockImplementation(async (_zone, dir) => dirs[dir] ?? []);
}

const zone = {} as never;

describe("promptStoragePath", () => {
  test("returns the picked file at the root", async () => {
    tree({ "": [entry("a.png", false), entry("b.png", false)] });
    prompts.inject(["b.png"]);

    expect(await promptStoragePath(zone, { message: "Pick" })).toBe("b.png");
  });

  test("drills into a directory and returns the nested path", async () => {
    tree({
      "": [entry("images", true)],
      "images/": [entry("photo.png", false)],
    });
    prompts.inject(["images/", "images/photo.png"]);

    expect(await promptStoragePath(zone, { message: "Pick" })).toBe(
      "images/photo.png",
    );
  });

  test("walks back up with ../", async () => {
    tree({
      "": [entry("images", true), entry("root.txt", false)],
      "images/": [entry("photo.png", false)],
    });
    // Into images/, back up, then take the root file.
    prompts.inject(["images/", "\u0000up", "root.txt"]);

    expect(await promptStoragePath(zone, { message: "Pick" })).toBe("root.txt");
  });

  test("selects a directory itself when allowDirectories is set", async () => {
    tree({
      "": [entry("images", true)],
      "images/": [entry("photo.png", false)],
    });
    prompts.inject(["images/", "\u0000here"]);

    expect(
      await promptStoragePath(zone, {
        message: "Pick",
        allowDirectories: true,
      }),
    ).toBe("images/");
  });

  test("never offers the zone root as a selectable directory", async () => {
    tree({ "": [entry("a.png", false)] });
    prompts.inject(["a.png"]);

    await promptStoragePath(zone, { message: "Pick", allowDirectories: true });

    // The root listing has no "select this directory" entry, so emptying a zone stays explicit.
    expect(listFiles).toHaveBeenCalledWith(zone, "");
  });

  test("returns undefined on an empty zone without prompting", async () => {
    tree({ "": [] });

    expect(await promptStoragePath(zone, { message: "Pick" })).toBeUndefined();
  });

  test("returns undefined when the user cancels", async () => {
    tree({ "": [entry("a.png", false)] });
    prompts.inject([undefined]);

    expect(await promptStoragePath(zone, { message: "Pick" })).toBeUndefined();
  });
});
