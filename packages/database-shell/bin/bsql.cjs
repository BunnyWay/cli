#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");

// Only x64 binaries use AVX2, so other arches report true; null means detection failed.
function hasAvx2() {
  if (process.arch !== "x64") return true;
  try {
    if (process.platform === "linux") {
      return readFileSync("/proc/cpuinfo", "utf8").includes("avx2");
    }
    if (process.platform === "darwin") {
      const features = execFileSync(
        "sysctl",
        ["-n", "machdep.cpu.leaf7_features"],
        { encoding: "utf8" },
      );
      return /avx2/i.test(features);
    }
  } catch {
    return null;
  }
  return null;
}

const PLATFORMS = {
  "darwin-arm64": "@bunny.net/database-shell-darwin-arm64",
  "darwin-x64": "@bunny.net/database-shell-darwin-x64",
  "linux-arm64": "@bunny.net/database-shell-linux-arm64",
  "linux-x64": "@bunny.net/database-shell-linux-x64",
  "win32-x64": "@bunny.net/database-shell-windows-x64",
};

const platform = `${process.platform}-${process.arch}`;
const pkg = PLATFORMS[platform];

if (!pkg) {
  console.error(
    `Unsupported platform: ${platform}\nSupported: ${Object.keys(PLATFORMS).join(", ")}`,
  );
  process.exit(1);
}

const binName = process.platform === "win32" ? "bsql.exe" : "bsql";

let binPath;
try {
  binPath = path.join(
    path.dirname(require.resolve(`${pkg}/package.json`)),
    binName,
  );
} catch {
  console.error(
    `Could not find the bsql binary for your platform (${platform}).\n` +
      `Expected package: ${pkg}\n\n` +
      `This usually means the optional dependency was not installed.\n` +
      `Try reinstalling: npm install @bunny.net/database-shell`,
  );
  process.exit(1);
}

if (!existsSync(binPath)) {
  console.error(`Binary not found at ${binPath}`);
  process.exit(1);
}

// The default binary uses AVX2; on pre-Haswell x64 CPUs it dies with SIGILL, so fall back to the baseline build shipped alongside it.
const baselinePath = path.join(path.dirname(binPath), "bsql-baseline");
const candidates = [binPath];
if (existsSync(baselinePath)) {
  candidates.push(baselinePath);
}
// Run the baseline first on x64 CPUs without AVX2, so we don't spawn the default binary just to catch its crash on every invocation.
const avx2 = hasAvx2();
if (candidates.length > 1 && avx2 === false) {
  candidates.reverse();
}

for (let i = 0; i < candidates.length; i++) {
  try {
    execFileSync(candidates[i], process.argv.slice(2), { stdio: "inherit" });
    process.exit(0);
  } catch (err) {
    if (err.status != null) {
      process.exit(err.status);
    }
    // Bun panics also exit via SIGILL, so only the AVX2 build on a CPU that may lack it retries or blames the CPU; retrying a real crash could repeat a deploy.
    if (
      err.signal === "SIGILL" &&
      avx2 !== true &&
      candidates[i] !== baselinePath
    ) {
      if (i < candidates.length - 1) continue;
      console.error(
        "bsql crashed with an illegal instruction; this CPU is not supported.",
      );
      process.exit(1);
    }
    if (err.signal) {
      console.error(
        `bsql crashed unexpectedly (${err.signal}); please report this with the output above.`,
      );
      process.exit(1);
    }
    console.error(`Failed to execute bsql binary: ${err.message}`);
    process.exit(1);
  }
}
