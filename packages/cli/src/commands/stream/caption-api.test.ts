import { expect, test } from "bun:test";
import { addVideoCaption, deleteVideoCaption } from "./caption-api.ts";
import type { StreamClient } from "./videos-api.ts";

interface Call {
  method: string;
  path: string;
  init?: Record<string, any>;
}

function fakeClient(opts: { calls: Call[]; data?: unknown }): StreamClient {
  const record = (method: string) => async (path: string, init?: any) => {
    opts.calls.push({ method, path, init });
    return { data: opts.data };
  };
  return {
    POST: record("POST"),
    DELETE: record("DELETE"),
  } as unknown as StreamClient;
}

test("addVideoCaption posts the base64 file, label, and srclang", async () => {
  const calls: Call[] = [];
  const client = fakeClient({
    calls,
    data: { success: true, data: { valid: true } },
  });

  const result = await addVideoCaption(client, 4321, "video-guid", "en", {
    label: "English",
    base64: "V0VCVlRU",
  });

  expect(result.warnings).toEqual([]);
  expect(calls[0]?.path).toBe(
    "/library/{libraryId}/videos/{videoId}/captions/{srclang}",
  );
  expect(calls[0]?.init?.params?.path).toEqual({
    libraryId: 4321,
    videoId: "video-guid",
    srclang: "en",
  });
  // srclang travels in the body as well as the path, per the schema.
  expect(calls[0]?.init?.body).toEqual({
    srclang: "en",
    label: "English",
    captionsFile: "V0VCVlRU",
  });
});

// The API validates the file, so a rejected upload has to name what is wrong.
test("addVideoCaption turns an invalid file into an error listing the problems", async () => {
  const client = fakeClient({
    calls: [],
    data: {
      success: false,
      message: "Invalid captions file",
      data: { valid: false, errorList: ["line 3: bad timestamp"] },
    },
  });

  const error = (await addVideoCaption(client, 4321, "v", "en", {
    base64: "eA==",
  }).then(
    () => {
      throw new Error("expected the upload to be rejected");
    },
    (err) => err,
  )) as { message: string; hint?: string };

  expect(error.message).toContain("The en captions were rejected");
  expect(error.hint).toBe("line 3: bad timestamp");
});

test("addVideoCaption rejects valid:false even when success is true", async () => {
  const client = fakeClient({
    calls: [],
    data: { success: true, data: { valid: false, errorList: [] } },
  });
  await expect(
    addVideoCaption(client, 4321, "v", "en", { base64: "eA==" }),
  ).rejects.toThrow(/The en captions were rejected/);
});

test("addVideoCaption returns warnings for a valid file with issues", async () => {
  const client = fakeClient({
    calls: [],
    data: {
      success: true,
      data: {
        valid: true,
        warningList: ["overlapping cues"],
        warningMessage: "1 warning found",
      },
    },
  });

  const result = await addVideoCaption(client, 4321, "v", "en", {
    base64: "eA==",
  });
  expect(result.warnings).toEqual(["overlapping cues"]);
  expect(result.warningMessage).toBe("1 warning found");
});

test("deleteVideoCaption deletes one language and surfaces a failed status", async () => {
  const calls: Call[] = [];
  await deleteVideoCaption(
    fakeClient({ calls, data: { success: true } }),
    4321,
    "video-guid",
    "en",
  );
  expect(calls[0]?.method).toBe("DELETE");
  expect(calls[0]?.init?.params?.path?.srclang).toBe("en");

  await expect(
    deleteVideoCaption(
      fakeClient({ calls: [], data: { success: false, message: "Not found" } }),
      4321,
      "v",
      "de",
    ),
  ).rejects.toThrow("Deleting the de captions failed: Not found");
});
