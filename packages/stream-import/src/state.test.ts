import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MigrationState } from "./contracts.ts";
import {
  createFileStateStore,
  getMigrationStateErrors,
  validateMigrationState,
} from "./state.ts";

const validState = (): MigrationState => ({
  id: "migration-1730000000000",
  startedAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:05:00.000Z",
  source: "some-future-platform",
  bunnyLibraryId: "12345",
  folderMappings: [
    {
      sourceFolderId: "f1",
      sourceFolderName: "Holiday",
      bunnyCollectionId: "col-1",
      bunnyCollectionName: "Holiday",
    },
  ],
  videoMigrations: [
    {
      sourceVideoId: "111",
      videoName: "Beach",
      sourceFolderId: null,
      bunnyVideoId: null,
      bunnyCollectionId: null,
      status: "pending",
      error: null,
      startedAt: null,
      completedAt: null,
      encodeProgress: 0,
    },
  ],
  status: "in_progress",
});

describe("validateMigrationState", () => {
  test("round-trips a valid state, including an unknown source id", () => {
    const original = validState();
    expect(
      validateMigrationState(JSON.parse(JSON.stringify(original))),
    ).toEqual(original);
    expect(getMigrationStateErrors(original)).toEqual([]);
  });

  test("rejects an unknown status, a numeric library ID, and junk, naming the path", () => {
    const badStatus = validState() as any;
    badStatus.videoMigrations[0].status = "halfway";
    expect(validateMigrationState(badStatus)).toBeNull();
    expect(getMigrationStateErrors(badStatus)[0]).toMatch(
      /videoMigrations\.0\.status/,
    );

    const numericId = validState() as any;
    numericId.bunnyLibraryId = 12345;
    expect(validateMigrationState(numericId)).toBeNull();

    for (const junk of [null, 42, "text", [], {}]) {
      expect(validateMigrationState(junk)).toBeNull();
    }
  });
});

describe("createFileStateStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stream-import-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("saves owner-only, loads back, ignores a corrupted file with a warning, and clears", () => {
    const path = join(dir, "nested", "vimeo-12345.json");
    const warnings: string[] = [];
    const store = createFileStateStore(path, {
      onWarn: (m) => warnings.push(m),
    });

    expect(store.load()).toBeNull();
    store.save(validState());
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(store.load()?.id).toBe("migration-1730000000000");

    writeFileSync(path, JSON.stringify({ id: "x" }));
    expect(store.load()).toBeNull();
    expect(warnings[0]).toMatch(/corrupted import state/);

    store.clear();
    expect(store.load()).toBeNull();
  });
});
