import { expect, test } from "bun:test";
import { addVideoCaption } from "./caption-api.ts";
import type { StreamClient } from "./videos-api.ts";

function fakeClient(data: unknown): StreamClient {
  return { POST: async () => ({ data }) } as unknown as StreamClient;
}

// A 200 with success:true can still carry valid:false, and the hint must name the problems.
test("addVideoCaption rejects an invalid file and lists what is wrong", async () => {
  const client = fakeClient({
    success: true,
    message: "Invalid captions file",
    data: { valid: false, errorList: ["line 3: bad timestamp"] },
  });

  const error = await addVideoCaption(client, 4321, "v", "en", {
    base64: "eA==",
  }).catch((err: unknown) => err);

  expect(error).toMatchObject({
    message: expect.stringContaining("The en captions were rejected"),
    hint: "line 3: bad timestamp",
  });
});
