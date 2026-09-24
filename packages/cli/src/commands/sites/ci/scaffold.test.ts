import { expect, test } from "bun:test";
import { projectPrefix, remoteHost } from "./scaffold.ts";

test("projectPrefix is empty at the workflow root and the POSIX offset when nested", () => {
  expect(projectPrefix("/repo", "/repo")).toBe("");
  expect(projectPrefix("/repo", "/repo/packages/site")).toBe("packages/site");
});

// A bunny.jsonc above the git root can't be referenced from a repo-rooted workflow.
test("projectPrefix is undefined when the project escapes the workflow root", () => {
  expect(projectPrefix("/repo/app", "/repo")).toBeUndefined();
});

test("remoteHost reads the host from scp-style and URL remotes", () => {
  expect(remoteHost("git@github.com:BunnyWay/cli.git")).toBe("github.com");
  expect(remoteHost("https://github.com/BunnyWay/cli.git")).toBe("github.com");
  expect(remoteHost("ssh://git@github.com/BunnyWay/cli.git")).toBe(
    "github.com",
  );
  expect(remoteHost("git@GitHub.com:BunnyWay/cli.git")).toBe("github.com");
});

// A substring check on the whole URL would treat all three of these as GitHub.
test("remoteHost does not confuse lookalike hosts for github.com", () => {
  expect(remoteHost("git@github.com.example.invalid:a/b.git")).toBe(
    "github.com.example.invalid",
  );
  expect(remoteHost("https://example.invalid/github.com/a/b")).toBe(
    "example.invalid",
  );
  expect(remoteHost("https://notgithub.com/a/b")).toBe("notgithub.com");
});
