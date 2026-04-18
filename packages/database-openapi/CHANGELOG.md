# @bunny.net/database-openapi

## 0.1.0

### Minor Changes

- [#43](https://github.com/BunnyWay/cli/pull/43) [`8537d2c`](https://github.com/BunnyWay/cli/commit/8537d2cfd3d7fe8c9ba9bd75fcd43c40490e3642) Thanks [@jamie-at-bunny](https://github.com/jamie-at-bunny)! - Add `@bunny.net/database-openapi` package

  Generates an OpenAPI 3.0.3 specification from a `DatabaseSchema` object. Zero
  dependencies - pass in a schema, get back a spec with:

  - Collection CRUD paths (`/{table}`)
  - Single-resource paths by primary key (`/{table}/{pk}`)
  - Unique column lookup paths (`/{table}/by-{column}/{value}`)
  - Typed schemas (base, insert, update) with name-aware example values
  - Error responses, reusable parameters, and top-level tags
  - Full index and unique constraint support
