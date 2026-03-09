#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

const PLATFORMS = {
  "darwin-arm64": "@bunny.net/cli-darwin-arm64",
  "darwin-x64": "@bunny.net/cli-darwin-x64",
  "linux-arm64": "@bunny.net/cli-linux-arm64",
  "linux-x64": "@bunny.net/cli-linux-x64",
  "win32-x64": "@bunny.net/cli-windows-x64",
};

const platform = `${process.platform}-${process.arch}`;
const pkg = PLATFORMS[platform];

if (!pkg) {
  console.error(
    `Unsupported platform: ${platform}\nSupported: ${Object.keys(PLATFORMS).join(", ")}`
  );
  process.exit(1);
}

const binName = process.platform === "win32" ? "bunny.exe" : "bunny";

let binPath;
try {
  binPath = path.join(path.dirname(require.resolve(`${pkg}/package.json`)), binName);
} catch {
  console.error(
    `Could not find the bunny binary for your platform (${platform}).\n` +
      `Expected package: ${pkg}\n\n` +
      `This usually means the optional dependency was not installed.\n` +
      `Try reinstalling: npm install @bunny.net/cli`
  );
  process.exit(1);
}

if (!existsSync(binPath)) {
  console.error(`Binary not found at ${binPath}`);
  process.exit(1);
}

try {
  execFileSync(binPath, process.argv.slice(2), { stdio: "inherit" });
} catch (err) {
  process.exit(err.status ?? 1);
}
