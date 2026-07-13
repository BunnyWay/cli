# Implementation plan: `bunny sites`

Phased plan for adding the `sites` namespace to the CLI — static-site hosting on top of a storage zone + pull zone + middleware Edge Script router, with atomic deploys, instant rollback, and per-deploy preview URLs.

Each phase is one reviewable PR. Every path, signature, and endpoint below has been verified against the current `main`.

## Decisions locked (from the RFC discussion)

- **One storage zone + one pull zone + one middleware router per site.** No DNS scripting — all deploys share one origin, so there is nothing for DNS to choose between.
- **Preview scheme:** `dpl-{id}.preview.{domain}` — a namespaced wildcard that can't shadow user subdomains, and preview-wide behavior (noindex, etc.) hangs on one host branch in the router.
- **Promote verb:** `sites deployments publish` for consistency with `scripts deployments publish`; `promote` as a hidden alias.
- **Deploy IDs:** git short-sha when the tree is clean, content hash otherwise; identical-hash deploys are no-ops.
- **Site identity:** the storage zone ID is the site ID (it's the root resource; the pull zone and script hang off it). The local manifest and remote state carry the full resource triple.

## What the repo already gives us (verified)

| Machinery                | Where                                                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command framework        | `packages/cli/src/core/define-command.ts`, `define-namespace.ts`  | `defineCommand<Args>({ command, describe, examples, builder, handler, preRun?, postRun? })`; `defineNamespace(command, describe \| false, subcommands, aliases?)`. Global args (`profile`, `verbose`, `output`, `apiKey`) are merged automatically; central error handling emits JSON errors when `output === "json"` and maps `UserError`/`ApiError` to exit 1, unexpected to exit 2.                                                                                                                                                                                                                                                                           |
| Root registration        | `packages/cli/src/cli.ts`                                         | Two arrays: `commands` (visible) and `experimentalCommands` (registered but hidden from help/landing — `apps`, `registries`, `sandbox`, `storage` live here). `sites` starts experimental, promoted in Phase 5.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Middleware scripts       | `commands/scripts/constants.ts`                                   | `SCRIPT_TYPE_MIDDLEWARE: EdgeScriptTypes = 2`, typed from `components["schemas"]["EdgeScriptTypes"]` in `@bunny.net/openapi-client/generated/compute.d.ts`. `parseScriptType("middleware") → 2`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Script creation          | `commands/scripts/create.ts`                                      | `createScript(opts)` → `POST /compute/script` with `{ Name, ScriptType, CreateLinkedPullZone, LinkedPullZoneName? }`. **The compute API creates the linked pull zone server-side** — see the Phase 0 attach question.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Env vars (promote lever) | `commands/scripts/env/set.ts`                                     | `PUT /compute/script/{id}/variables` body `{ Name, DefaultValue }`. A single PUT, **no republish call exists or is needed** at the API level (runtime propagation latency is a Phase 0 question). `fetchEnvEntries(client, id)` in `scripts/api.ts` reads them back.                                                                                                                                                                                                                                                                                                                                                                                             |
| Publish/rollback UX      | `commands/scripts/deployments/publish.ts`                         | `selectScript(client, { id, link, output })` (flag → `.bunny/` manifest → interactive picker with offer-to-link, from `scripts/interactive.ts`) → `confirm(msg, { force })` → POST. `deployments/list.ts` shows the `● Live` / `○ Archived` table style.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Storage files API        | `commands/storage/files-api.ts`                                   | `connectStorageZone(zone)` (needs the **full** zone record incl. `Password` — `resolveStorageZone`/`fetchStorageZone` in `storage/api.ts` re-fetch by ID to get it), `listFiles`, `uploadFile(zone, remotePath, stream, options?)`, `downloadFile`, `deleteFile`. **Checksums are caller-side**: `storage/file/upload.ts` computes streaming SHA-256 via `Bun.CryptoHasher("sha256")`, `.digest("hex").toUpperCase()`, passed as `UploadOptions.sha256Checksum`.                                                                                                                                                                                                 |
| Storage zone creation    | `commands/storage/zone/add.ts`                                    | `POST /storagezone` body `{ Name, Region, ReplicationRegions }` on the core client. This file is also the template for create-then-domain orchestration (it composes `createPullZone` + `setupHostname`).                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Pull zone creation       | `core/hostnames/client.ts`                                        | `createPullZone(coreClient, name, storageZoneId)` → `POST /pullzone` with `{ Name, StorageZoneId, OriginType: 2, EnableGeoZone*: true }`. Also `addHostname`, `enableSsl` (`GET /pullzone/loadFreeCertificate` + `POST /pullzone/{id}/setForceSSL`), `fetchPullZoneHostnames`, `normalizeHostname`, `hostnameUrl`, `liveHostnames`.                                                                                                                                                                                                                                                                                                                              |
| Hostname orchestration   | `core/hostnames/flow.ts`, `commands.ts`, `bunny-dns.ts`, `dns.ts` | `setupHostname(opts)` is the full top-level flow (add hostname → Bunny-DNS auto-record or manual CNAME → DNS wait → SSL with retries). `createHostnamesCommands(opts)` is a **namespace factory** returning ready-made `add`/`ssl`/`list`/`remove` commands for any pull-zone-backed resource — its docstring explicitly anticipates new resource types. `findBunnyDnsZone`/`offerBunnyDnsRecord` handle PULLZONE-type DNS records; delegation checks come from `core/dns-nameservers.ts` (`checkDelegation`, `expectedNameservers`). `core/registrar.ts` is RDAP registrar _detection_ only (useful for naming the registrar in NS instructions, nothing more). |
| DNS record presets       | `commands/dns/record/presets.ts`                                  | `DnsPreset { id, title, category, params, build(ctx) → AddDnsRecordModel[] }` with `mx/txt/cname/caa` builder helpers. Note: `PRESETS` is a user-facing catalog (email/verification) — the sites apex + wildcard pair should reuse the _builder-helper pattern_ internally, not ship as a public preset.                                                                                                                                                                                                                                                                                                                                                         |
| Local manifests          | `core/manifest.ts`                                                | `loadManifest<T>` / `saveManifest<T>` (mode 0600) / `removeManifest` / `saveManifestAt` / `resolveManifestId(filename, id, resourceType)` — all keyed by filename under `.bunny/`, walking up the tree. Pattern: each resource exports a manifest filename constant (`SCRIPT_MANIFEST = "script.json"`, `STORAGE_MANIFEST = "storage.json"`).                                                                                                                                                                                                                                                                                                                    |
| Output/UI                | `core/format.ts`, `core/logger.ts`, `core/ui.ts`                  | `formatTable(headers, rows, format)` / `formatKeyValue(entries, format)` handle `text\|table\|csv\|markdown` but **not** `json` — handlers check `output === "json"` first and `logger.log(JSON.stringify(data, null, 2))`. `logger.log` is the only stdout method (everything else is stderr, so JSON stays clean). `spinner()`, `confirm(msg, { force })`, `isInteractive(output)`, plus `formatBytes`, `progressBar`, `maskSecret` in format.ts.                                                                                                                                                                                                              |
| Cache purge              | `specs/core.json`                                                 | `POST /pullzone/{id}/purgeCache` exists in the spec; **nothing in the CLI calls it yet** — promote will be the first consumer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Clients                  | `@bunny.net/openapi-client`                                       | `createCoreClient` (storage zones, pull zones, DNS), `createComputeClient` (scripts), `createStorageClient`. Wiring: `resolveConfig(profile, apiKey, verbose)` (from `packages/cli/src/config/index.ts`) → `clientOptions(config, verbose)` → factory.                                                                                                                                                                                                                                                                                                                                                                                                           |

## Phase 0 — Spike: validate platform assumptions (no merge)

The design rests on six assumptions. Kill or confirm each with a throwaway script/dashboard session before writing CLI code:

1. **Attach mechanism.** How does a middleware script get onto a _storage-backed_ pull zone? The CLI's only current path is `POST /compute/script` with `CreateLinkedPullZone: true`, where the compute API creates the pull zone itself. Determine which works:
   - (a) create the script with a linked pull zone, then repoint that pull zone's origin to the storage zone (`POST /pullzone/{id}` with `{ OriginType: 2, StorageZoneId }`), or
   - (b) create the pull zone via `createPullZone()` first, then link the script to it (find the linking field/endpoint in `specs/core.json` / `specs/compute.json`).
     The answer decides the `sites create` orchestration order in Phase 1.
2. **Per-request rewrite.** Middleware attached to the pull zone can rewrite the origin request path per-request based on the `Host` header.
3. **Env-var propagation.** Updating `CURRENT_DEPLOY` via `PUT /compute/script/{id}/variables` takes effect without republishing code (the API requires no republish — verified in code), and propagates globally in acceptable time (target: seconds).
4. **Wildcard hostnames + certs.** `*.preview.example.com` can be added via `POST /pullzone/{id}/addHostname`, and cert issuance automates when the zone is on Bunny DNS. Specifically check whether `GET /pullzone/loadFreeCertificate` (what `enableSsl` uses) handles wildcards, or whether a DNS-01 flow needs a different endpoint.
5. **Cache isolation.** Cache keys include the original request URL/host, so previews and production don't cross-contaminate, and one `POST /pullzone/{id}/purgeCache` on promote is sufficient.
6. **Upload throughput.** `uploadFile` through `storage/files-api.ts` is acceptable for a ~200-file site at 8-way concurrency.

Exit artifact: a short findings note in the Phase 1 PR description, plus the working router script from the spike.

**Fallback if (2) or (3) fails:** static path-based previews (`preview.domain/deploys/{id}/`) with promote via edge-rule swap — the v1 RFC design. The command surface is identical either way, so later phases are unaffected.

## Phase 1 — Scaffolding + site lifecycle

**Commands:** `sites create <name> [--domain]`, `list`, `show [site]`, `link [site]`, `unlink`, `delete <site> [--force] [--keep-storage]`

New files under `packages/cli/src/commands/sites/`:

```
index.ts            # export const sitesNamespace = defineNamespace("sites", false, [...])
constants.ts        # SITES_MANIFEST = "site.json" (→ .bunny/site.json)
                    # REMOTE_STATE_PATH = "_bunny/site.json"
                    # SiteManifest { id: number; name?: string; pullZoneId?: number; scriptId?: number }
                    # RemoteSiteState { version; siteName; storageZoneId; pullZoneId; scriptId;
                    #                   routerVersion; current?; previous?; deploys: DeployRecord[];
                    #                   stateChecksum? }
api.ts              # provisioning orchestration + remote-state read/write + fetch/resolve helpers
interactive.ts      # resolveSiteInteractive — mirrors storage/interactive.ts
router/source.ts    # router script source as an exported template string (from the spike)
create.ts, list.ts, show.ts, link.ts, unlink.ts, delete.ts
```

Registration: add `sitesNamespace` to the `experimentalCommands` array in `packages/cli/src/cli.ts` (hidden while WIP — the `storage` pattern). Promote to `commands` in Phase 5.

**`create` orchestration** (in `api.ts`; each step looks up by name before creating, so a failed create re-runs cleanly):

1. Create storage zone (`POST /storagezone`, core client — reuse the body shape from `storage/zone/add.ts`).
2. Create pull zone with storage origin + create middleware router from `router/source.ts` — exact order/mechanism per the Phase 0 attach answer. Script upload uses the existing `POST /compute/script/{id}/code` + `POST /compute/script/{id}/publish` pair from `scripts/deploy.ts`.
3. Set `CURRENT_DEPLOY=""` (`PUT /compute/script/{id}/variables`).
4. Write remote `_bunny/site.json` via `connectStorageZone` + `uploadFile`.
5. `saveManifest<SiteManifest>(SITES_MANIFEST, { id, name, pullZoneId, scriptId })` unless `--no-link` (mirror `scripts/create.ts`).
6. If `--domain`: invoke the Phase 3 flow. The flag ships **hidden** in Phase 1 (stub that throws `UserError` with a "coming soon" hint).

Client wiring in every handler, per convention:

```ts
const config = resolveConfig(profile, apiKey, verbose);
const coreClient = createCoreClient(clientOptions(config, verbose));
const computeClient = createComputeClient(clientOptions(config, verbose));
```

**Router script v1** (~30 lines, from the spike): apex/`.b-cdn.net` host → serve `/deploys/{CURRENT_DEPLOY}{path}`; `^dpl-[a-z0-9]+\.preview\.` host → that deploy's prefix; `/_bunny/*` → 403; empty `CURRENT_DEPLOY` → friendly "no deploys yet" page.

**Command behaviors:**

- `list` — `formatTable(["ID", "Name", "Hostname", "Deploys", "Current"], rows, output)`; `output === "json"` first; empty state via `logger.info`.
- `show [site]` — `resolveSiteInteractive` → `formatKeyValue` sections (site, resources, current deploy, hostnames via `fetchPullZoneHostnames` + `liveHostnames`).
- `link`/`unlink` — `saveManifest`/`removeManifest`, mirroring `storage/link.ts`.
- `delete` — `confirm(..., { force })`; teardown order: script (detach/delete first), pull zone, then storage zone unless `--keep-storage`.

**Tests** (co-located `*.test.ts`, `bun:test`): provisioning-order and idempotent re-run against a hand-rolled fake client (object literal branching on path strings, cast `as unknown as CoreClient` — the pattern in `core/hostnames/bunny-dns.test.ts`, with `mock.module` + dynamic import where sibling modules need stubbing); manifest round-trip; router source snapshot.

## Phase 2 — Deploy + deployments (the core loop)

**Commands:** `sites deploy [dir]`, `sites deployments list`, `sites deployments publish <id> [--previous] [--force]` (alias `promote`)

New files: `deploy.ts`, `deploy-id.ts` (+ test), `uploader.ts` (+ test), `deployments/{index,list,publish}.ts`

Work items, in dependency order:

1. **`deploy-id.ts`** — pure functions, easy unit tests: `gitShaId()` (shell out via `Bun.spawn` to `git rev-parse --short HEAD`, detect dirty tree with `git status --porcelain`), `contentHashId(files)` (sorted path+sha256 merkle → 8 hex chars).
2. **`uploader.ts`** — walk dir (v1: upload everything except dotfiles); per-file streaming SHA-256 via `Bun.CryptoHasher("sha256")` → `UploadOptions.sha256Checksum` (the `storage/file/upload.ts` pattern); 8-way concurrent `uploadFile` with retry/backoff; progress via `spinner()` from `core/ui.ts` + `progressBar()`/`formatBytes()` from `core/format.ts` (stderr, so `--output json` stays clean).
3. **Remote state read-modify-write** in `api.ts` — `downloadFile` `_bunny/site.json`, append deploy record, re-upload. Include a `stateChecksum` field checked before write (cheap optimistic lock; log-and-overwrite on mismatch in v1). Reading the storage zone for `connectStorageZone` must go through `fetchStorageZone`/`resolveStorageZone` (they return the full record with `Password`).
4. **`deploy.ts`** — resolve site (flag → manifest → picker with offer-to-link, mirroring `selectScript` in `scripts/interactive.ts`) → compute ID → short-circuit if ID equals `current` ("no changes") → upload to `/deploys/{id}/` → update state → promote (env var + `POST /pullzone/{id}/purgeCache`) unless `--no-promote` → print production + preview URLs via `hostnameUrl`.
5. **`deployments list`** — table `["ID", "Age", "Git", "Source", "Files", "Size", "Status"]` with `● ACTIVE` marker (the `scripts/deployments/list.ts` style, `formatDateTime` for dates); `--output json` free via the shared flag.
6. **`deployments publish`** — reuse the `scripts/deployments/publish.ts` confirm/`--force` UX; update env var, purge, swap `current`/`previous` in state. `--previous` is sugar for instant rollback.

End state: the full Pages loop works against `.b-cdn.net`, with subdomain-preview infrastructure already live (previews resolve once a domain exists; path previews `/deploys/{id}/` work immediately).

## Phase 3 — Domains

**Commands:** `sites domains add <domain>`, `list`, `remove <domain> [--purge-dns]`

Mount `createHostnamesCommands()` from `core/hostnames/commands.ts` — it exists for exactly this ("any resource backed by a pull zone") and returns ready-made `add`/`ssl`/`list`/`remove` commands given a `resolve: (args) => Promise<ResolvedPullZone>`:

```ts
createHostnamesCommands({
  commandPath: "sites domains",
  namespace: "domains",
  resolve: resolveSitePullZone, // site arg/manifest/picker → { pullZoneId, coreClient }
  hiddenAliases: ["hostnames"],
});
```

Sites-specific extension on top of the factory's `add` (wrap it or add a hook): after the apex succeeds, also attach `*.preview.<domain>` via `addHostname`, create the DNS pair on the owning Bunny DNS zone (apex as PULLZONE-type record via `findBunnyDnsZone`/`offerBunnyDnsRecord`; wildcard record alongside — model the pair with the `mx/txt/cname`-style builder helpers from `dns/record/presets.ts`, kept internal to sites rather than added to the public `PRESETS` catalog), then trigger cert issuance and poll with a spinner until valid (`offerDnsWaitAndSsl` already does poll-then-issue with retries; wildcard-cert specifics per the Phase 0 answer).

Also: un-hide `create --domain` and wire it to this flow (`storage/zone/add.ts` and `setupCustomDomain` in `scripts/create.ts` are the composition templates). `show` gains a domains section with cert status.

Edge cases handled explicitly:

- Nameservers not pointed at Bunny yet — `checkDelegation`/`expectedNameservers` from `core/dns-nameservers.ts` detect it (that's how `bunny-dns.ts` sets `match.delegated`); print NS instructions (use `detectRegistrar` from `core/registrar.ts` to name the registrar) and exit 0 with a "re-run when propagated" hint.
- A preexisting conflicting record at the apex — `offerBunnyDnsRecord` already handles repointing with a prompt; surface it clearly.

## Phase 4 — Env vars + builds

**Commands:** `sites env set/list/remove/pull`, plus `deploy --build [cmd]`

- Env store at `_bunny/env.json` (already 403-blocked by the router), read/write through `downloadFile`/`uploadFile`; values echoed masked in `list` via `maskSecret()` from `core/format.ts` unless `--show`.
- `deploy --build`: merge remote env + `--env`/`--env-file` overrides → spawn build command via `Bun.spawn` (from flag or `bunny.jsonc`) with merged environment → then the normal deploy path on the output dir. Record `envHash` in the deploy entry.
- **`bunny.jsonc` support:** add an optional top-level `sites` block to `BunnyAppConfigSchema` in `packages/app-config/src/schema.ts` — `sites: SitesConfigSchema.optional()` with `{ name?, dir?, build? }`, exported sub-schema + `z.infer` type, mirroring `ProbeConfigSchema` et al. Regenerate `generated/schema.json` via `packages/app-config/scripts/generate-schema.ts` (`z.toJSONSchema(..., { target: "draft-2020-12" })`). `saveConfig`'s re-keying (`$schema`, `version`, `...rest`) preserves the new key automatically; consider bumping `CURRENT_VERSION` (date-versioned). Separate changeset, minor bump for `@bunny.net/app-config`.
- Loud docs + CLI warning: build-time env is baked into the bundle; **not a secret store**.

## Phase 5 — Polish + ship

- `deployments prune [--keep N]` (never prunes `current`/`previous`).
- `X-Robots-Tag: noindex` on preview hosts in the router; router version handling — store `routerVersion` in remote state; `sites show` warns when an upgrade is available; `sites upgrade` republishes the router source.
- Promote `sitesNamespace` from `experimentalCommands` to `commands` in `cli.ts` with a real `describe`.
- Update `skills/bunny-cli/` — Quick Start mention in `SKILL.md` plus a new `references/sites.md` (matching the existing per-area reference docs: `api.md`, `auth.md`, `database.md`, `dns.md`, `scripts.md`). This is the tie-in to the sandbox project: the app-builder supervisor just runs `bunny sites deploy ./dist --build`.
- Docs PR to `BunnyWay/documentation` (Mintlify page under CDN or a new Sites section) with the deploy→rollback quickstart.
- Release: changesets (minor `@bunny.net/cli`, minor `@bunny.net/app-config`; the `fixed` group in `.changeset/config.json` propagates the CLI bump to the platform binaries automatically), `bun run typecheck`, `bun run lint`, `bun test`.

## Cross-cutting conventions checklist (applies to every phase)

Per `AGENTS.md` "Conventions for Adding New Commands" and `CLAUDE.md`:

- `defineCommand()`/`defineNamespace()` for everything; register in `cli.ts`.
- Flag equivalents for every interactive prompt; prompts gated on `isInteractive(output)` and skipped under `--force`.
- `--output json` handled first in every handler (`logger.log(JSON.stringify(data, null, 2)); return;`); all status/progress output through `logger.*` (stderr) or `spinner()` so JSON stays parseable.
- `UserError(message, hint?)` for expected failures; never raw `throw new Error` for user-facing conditions.
- `resolveConfig(profile, apiKey, verbose)` + `clientOptions(config, verbose)` for all clients; import clients from `@bunny.net/openapi-client` and generated types from `@bunny.net/openapi-client/generated/<spec>.d.ts` (`core.d.ts` for storage/pull zones/DNS, `compute.d.ts` for scripts). Prefer `Pick<components["schemas"]["X"], ...>` over inline primitives.
- Co-located `*.test.ts` with `bun:test`; fake clients as path-branching object literals; `mock.module` for sibling stubs.
- Update `README.md` (command examples) and `AGENTS.md` (Command Reference tree + file listing + manifest section) in the same PR as the code.
- One changeset per PR.

## Sequencing and effort

Phase 0 is a day of poking the platform and decides everything — do it first, alone. Phases 1–2 are the meat (roughly a week together) and ship a usable feature on their own. Phase 3 is mostly composition of `core/hostnames/` (1–2 days if the wildcard-cert API cooperates — `createHostnamesCommands` removes most of the surface work). Phases 4–5 are independent and can trail.

Branch/PR naming: `feat/sites-scaffolding`, `feat/sites-deploy`, `feat/sites-domains`, `feat/sites-env`, `feat/sites-polish`, each with its own changeset.
