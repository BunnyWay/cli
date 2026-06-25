# @bunny.net/scriptable-dns-types

Ambient TypeScript types for the [bunny.net Scriptable DNS](https://docs.bunny.net/docs/dns-scripting) runtime.

Scriptable DNS scripts run with a set of globals injected by the runtime (`ARecord`, `Monitoring`, `RoutingEngine`, and so on). Because the runtime does not support `import`, these are provided as ambient declarations: they power editor autocomplete and an optional typecheck step, but are never imported at runtime.

## Usage

Add the package as a dev dependency, then reference it from your script or your `tsconfig.json`.

Reference from the script file:

```js
/// <reference types="@bunny.net/scriptable-dns-types" />

/** @param {DnsRequest} query */
export default function handleQuery(query) {
  if (query.request.geoLocation.country === "DE") {
    return new ARecord("203.0.113.20", 30);
  }
  return new ARecord("203.0.113.10", 30);
}
```

Or wire it up globally in `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "types": ["@bunny.net/scriptable-dns-types"],
  },
}
```

The CLI scaffolds all of this for you with `bunny dns scripts init`.
