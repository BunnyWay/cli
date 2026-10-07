import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { embedUrl, parseDuration, signEmbedUrl } from "./embed-url.ts";

test("parseDuration reads s, m, h, d and bare seconds", () => {
  expect(parseDuration("90")).toBe(90);
  expect(parseDuration("30m")).toBe(1800);
  expect(parseDuration("1h")).toBe(3600);
  expect(parseDuration("7d")).toBe(604800);
  expect(() => parseDuration("soon")).toThrow(
    'Invalid --expires value "soon".',
  );
});

// token = SHA256_HEX(token_security_key + video_id + expires), per the token authentication docs.
test("signEmbedUrl appends the documented token and expiry", () => {
  const url = embedUrl(759, "eb1c4f77-0cda-46be-b47d-1118ad7c2ffe");
  const expected = createHash("sha256")
    .update(
      "4742a81b-bf15-42fe-8b1c-8fcb9024c550eb1c4f77-0cda-46be-b47d-1118ad7c2ffe1456761770",
    )
    .digest("hex");
  expect(
    signEmbedUrl(
      url,
      "eb1c4f77-0cda-46be-b47d-1118ad7c2ffe",
      "4742a81b-bf15-42fe-8b1c-8fcb9024c550",
      1456761770,
    ),
  ).toBe(
    `https://player.mediadelivery.net/embed/759/eb1c4f77-0cda-46be-b47d-1118ad7c2ffe?token=${expected}&expires=1456761770`,
  );
});
