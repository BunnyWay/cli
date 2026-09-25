// `.bunny/stream.json` records the directory's video library and is resolved by stream commands.
export const STREAM_MANIFEST = "stream.json";

export interface StreamLibraryManifest {
  id: number;
  name?: string;
}
