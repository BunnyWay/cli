# @bunny.net/monorepo

Monorepo for the [bunny.net](https://bunny.net) CLI and supporting packages.

## Packages

| Package                                                                  | Name                                 | Description                                                  |
| ------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------ |
| [`packages/cli/`](packages/cli/)                                         | `@bunny.net/cli`                     | Command-line interface for bunny.net                         |
| [`packages/api/`](packages/api/)                                         | `@bunny.net/api`                     | Standalone, type-safe API client SDK                         |
| [`packages/app-config/`](packages/app-config/)                           | `@bunny.net/app-config`              | Shared Zod schemas, types, and JSON Schema for `bunny.jsonc` |
| [`packages/database-shell/`](packages/database-shell/)                   | `@bunny.net/database-shell`          | Standalone interactive SQL shell for libSQL databases        |
| [`packages/database-openapi/`](packages/database-openapi/)               | `@bunny.net/database-openapi`        | Generate OpenAPI 3.0 specs from a database schema            |
| [`packages/database-rest/`](packages/database-rest/)                     | `@bunny.net/database-rest`           | PostgREST-like REST API handler (database-agnostic)          |
| [`packages/database-adapter-libsql/`](packages/database-adapter-libsql/) | `@bunny.net/database-adapter-libsql` | Bunny Database adapter for database-rest                     |

See each package's README for usage and API documentation.

## Installation

```bash
# Shell installer (downloads prebuilt binary)
curl -fsSL https://cli.bunny.net/install.sh | sh

# Or via npm
npm install -g @bunny.net/cli

# Or via bun
bun install -g @bunny.net/cli
```

## Development

```bash
# Install dependencies
bun install

# Run the CLI locally
bun ny <command>

# Examples
bun ny login
bun ny db list
bun ny apps deploy
```

### Available Scripts

```bash
# Type check the entire monorepo
bun run typecheck

# Run tests
bun test

# Build standalone executable
bun run build

# Update OpenAPI specs and regenerate types
bun run api:update

# Regenerate types from existing specs
bun run api:generate
```

### Changesets

This monorepo uses [changesets](https://github.com/changesets/changesets) for versioning and changelogs.

```bash
# Add a changeset (interactive prompt)
bun run changeset

# Apply changesets and bump versions
bun run version

# Publish all packages
bun run release
```

### Making the CLI available globally

```bash
bun link
bunny <command>
```
