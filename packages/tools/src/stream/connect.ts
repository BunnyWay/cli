import { UserError } from "@bunny.net/openapi-client";
import type { StreamClient, ToolContext } from "../context.ts";
import { fetchAccountId, resolveLibrary } from "./api.ts";
import { type StreamLibrary, toStreamLibrary } from "./model.ts";

export interface StreamLibraryConnection {
  library: StreamLibrary;
  accountId: string;
  /** Authenticated with the library's own Stream key, which never leaves this object. */
  client: StreamClient;
}

/** Resolve a library by name or ID and open a Stream client on it; not a tool, since a live client is not serializable. */
export async function openStreamLibrary(
  ctx: ToolContext,
  nameOrId: string | number,
): Promise<StreamLibraryConnection> {
  const [model, accountId] = await Promise.all([
    resolveLibrary(ctx.clients.core, nameOrId, { signal: ctx.signal }),
    fetchAccountId(ctx.clients.core, { signal: ctx.signal }),
  ]);
  const library = toStreamLibrary(model);
  if (!model.ApiKey) {
    throw new UserError(
      `No API key available for video library ${library.name || library.id}.`,
      "Video operations need the library's own Stream API key; check that the account key can read it.",
    );
  }
  return {
    library,
    accountId,
    client: ctx.clients.streamLibrary(model.ApiKey),
  };
}
