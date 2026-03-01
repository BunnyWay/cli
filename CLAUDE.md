
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

## Project conventions

- See `AGENTS.md` for full architecture documentation.
- Commands use `defineCommand()` from `src/core/define-command.ts`.
- Namespaces use `defineNamespace()` from `src/core/define-namespace.ts`.
- Resolve config via `resolveConfig(profile, apiKey)` — always pass both args.
- Use `formatTable()` / `formatKeyValue()` from `src/core/format.ts` for non-JSON output.
- Handle `--output json` first in every handler, then pass `output` to format functions.
- Use `logger` from `src/core/logger.ts` for all user-facing output.
- Throw `UserError` for expected errors.
- Database commands use v2 API endpoints (`/v2/databases/...`).
- Apps (Magic Containers) commands use `bunny.toml` as the single source of truth. App ID is stored in the toml (no separate manifest file). Use `resolveAppId()` and `resolveContainerId()` from `src/commands/apps/toml.ts`. Pass `undefined` (not `config.apiUrl`) as the second arg to `createMcClient()`.
- Prefer generated schema types over inline primitives. Use `Pick<components["schemas"]["TypeName"], "field1" | "field2">` instead of `{ field1: string; field2: number }`. Only fall back to `string`, `any`, or `number` when no generated type exists.

## Documentation

When adding, changing, or removing commands or flags, update the corresponding sections in:

- `README.md` — user-facing command docs and examples.
- `AGENTS.md` — architecture docs, command reference tree, and file listing.
