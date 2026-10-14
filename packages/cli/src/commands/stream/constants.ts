// `.bunny/stream.json` is written by `bunny stream libraries link` and resolved by stream commands.
export const STREAM_MANIFEST = "stream.json";

export interface StreamLibraryManifest {
  id: number;
  name?: string;
}
