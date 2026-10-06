// `.bunny/stream.json` is written by `bunny stream library link` (or offered by pickers) and resolved by stream commands.
export const STREAM_MANIFEST = "stream.json";

export interface StreamLibraryManifest {
  id: number;
  name?: string;
}
