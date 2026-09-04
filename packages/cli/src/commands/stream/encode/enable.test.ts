import { expect, test } from "bun:test";
import { encodeEnableBody } from "./enable.ts";

// The whole point of the command is the tier, so it is always in the body.
test("encodeEnableBody always sets the premium tier", () => {
  expect(encodeEnableBody({})).toEqual({ EncodingTier: 1 });
});

test("encodeEnableBody folds in the optional flags", () => {
  expect(
    encodeEnableBody({ jit: true, codecs: "x264,vp9", resolutions: "720p" }),
  ).toEqual({
    EncodingTier: 1,
    JitEncodingEnabled: true,
    OutputCodecs: "x264,vp9",
    EnabledResolutions: "720p",
  });
});

test("encodeEnableBody keeps an explicit --no-jit", () => {
  expect(encodeEnableBody({ jit: false })).toEqual({
    EncodingTier: 1,
    JitEncodingEnabled: false,
  });
});

test("encodeEnableBody validates the codec and resolution lists", () => {
  expect(() => encodeEnableBody({ codecs: "x264,divx" })).toThrow(
    /Invalid --codecs value\(s\): divx/,
  );
  expect(() => encodeEnableBody({ resolutions: "4k" })).toThrow(
    /Invalid --resolutions value\(s\): 4k/,
  );
});
