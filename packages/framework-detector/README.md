# @bunny.net/framework-detector

Detects a project's web framework and package manager, and knows how each framework builds and
where it writes its output. It is what `bunny sites` uses to deploy a project without asking, and it
has no dependencies and touches no disk or network, so the CLI, the bunny.net dashboard and the
Sites control plane all run the same code.

```sh
npm install @bunny.net/framework-detector
```

## Detect a framework

Detection reads a snapshot of a project root rather than the file system, so you can build the
snapshot from disk, from a GitHub repository, or by hand in a test:

```ts
import { detectFrameworkFrom, detectPackageManagerFrom } from "@bunny.net/framework-detector";

const entries = ["package.json", "pnpm-lock.yaml", "astro.config.mjs", "src"];
const packageJson = { devDependencies: { astro: "^5.0.0" } };

const preset = detectFrameworkFrom({ entries, packageJson });
// { id: "astro", label: "Astro", dir: "dist", toolchain: "js" }

detectPackageManagerFrom(entries); // "pnpm"
```

A snapshot is the root's `entries` plus the contents of the few files detection reads
(`DETECTION_CONTENT_FILES`): `packageJson`, `gemfile`, and `csprojs` for Blazor WebAssembly.
Everything else is a presence check on `entries`. `undefined` means no framework was recognised.

## Presets

`FRAMEWORK_PRESETS` lists every supported framework with its output `dir`, its `toolchain`, an
optional `build` command and whether it is a single-page app (`spa`). `findPreset(id)` looks one up,
and `presetBuildCommand(preset, packageManager)` returns the command to run locally.

## GitHub Actions workflow

`renderSitesWorkflow(...)` writes the workflow `bunny sites ci init` creates at
`SITES_WORKFLOW_PATH` (`.github/workflows/bunny-sites.yml`): install, build and deploy to a
bunny.net site on every push.
