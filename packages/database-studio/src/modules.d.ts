// `with { type: "file" }` imports are paths; @types/bun doesn't declare these extensions.
declare module "*.js" {
  const path: string;
  export default path;
}

declare module "*.css" {
  const path: string;
  export default path;
}
