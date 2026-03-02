const pkg = await Bun.file(
  new URL("../../package.json", import.meta.url),
).json();

export const VERSION: string = pkg.version;
