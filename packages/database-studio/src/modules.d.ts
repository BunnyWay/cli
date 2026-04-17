// Bun's `with { type: "file" }` returns a resolved file path as a string at
// runtime, but `@types/bun` only declares ambient modules for a few extensions.
// Declare the ones we import in `client-manifest.ts`.
declare module "*.js" {
  const path: string;
  export default path;
}

declare module "*.css" {
  const path: string;
  export default path;
}
