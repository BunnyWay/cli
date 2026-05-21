Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## Runtime

- `Bun.serve()` for HTTP servers (used by auth login callback). Don't use `express`.
- `Bun.spawn()` for subprocesses (opening browsers). Don't use `execa`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile where applicable.

## Testing

Use `bun test` to run tests.

```ts
import { test, expect, describe } from "bun:test";

test("example", () => {
  expect(1).toBe(1);
});
```

## Monorepo structure

This is a Bun workspace monorepo with four packages:

- `packages/openapi-client/` (`@bunny.net/openapi-client`) — standalone, type-safe OpenAPI client, zero CLI deps
- `packages/app-config/` (`@bunny.net/app-config`) — shared Zod schemas, types, and JSON Schema for `bunny.jsonc`
- `packages/database-shell/` (`@bunny.net/database-shell`) — standalone SQL shell engine (REPL, formatting, masking)
- `packages/cli/` (`@bunny.net/cli`) — the CLI, depends on all three

## Project conventions

- See `AGENTS.md` for full architecture documentation.
- Commands use `defineCommand()` from `packages/cli/src/core/define-command.ts`.
- Namespaces use `defineNamespace()` from `packages/cli/src/core/define-namespace.ts`.
- Resolve config via `resolveConfig(profile, apiKey, verbose)` — always pass `profile` and `apiKey`; pass `verbose` so credential-source debug lines respect the flag.
- Use `formatTable()` / `formatKeyValue()` from `packages/cli/src/core/format.ts` for non-JSON output.
- Handle `--output json` first in every handler, then pass `output` to format functions.
- Use `logger` from `packages/cli/src/core/logger.ts` for all user-facing output.
- Throw `UserError` for expected errors.
- Import API clients from `@bunny.net/openapi-client`, not relative paths. Import generated types from `@bunny.net/openapi-client/generated/<spec>.d.ts`.
- Use `clientOptions(config, verbose)` from `packages/cli/src/core/client-options.ts` when creating API clients in command handlers.
- Database commands use v2 API endpoints (`/v2/databases/...`).
- Apps (Magic Containers) commands use `bunny.jsonc` as the single source of truth. App ID is stored in the config (no separate manifest file). Use `resolveAppId()` and `resolveContainerId()` from `packages/cli/src/commands/apps/config.ts`. Types and conversion functions come from `@bunny.net/app-config`.
- Prefer generated schema types over inline primitives. Use `Pick<components["schemas"]["TypeName"], "field1" | "field2">` instead of `{ field1: string; field2: number }`. Only fall back to `string`, `any`, or `number` when no generated type exists.

## Documentation

When adding, changing, or removing commands or flags, update the corresponding sections in:

- `README.md` — user-facing command docs and examples.
- `AGENTS.md` — architecture docs, command reference tree, and file listing.
