import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { UserError } from "@bunny.net/openapi-client";
import { z } from "zod";
import type { ActionContext } from "../../context.ts";
import type { Action } from "../../define-action.ts";
import { defineAction } from "../../define-action.ts";
import { resolveStorageZone } from "./api.ts";
import {
  connectStorageZone,
  deleteFile,
  downloadFile,
  listFiles,
  type StorageFileEntry,
  StorageFileEntrySchema,
  type StorageZoneConnection,
  toStorageFileEntry,
  uploadFile,
} from "./files-api.ts";

// This file uses node:fs/node:crypto (not Bun.file) so the package stays importable from Node hosts.

const zoneRef = z
  .string()
  .min(1)
  .describe("Storage zone name or numeric ID that holds the files.");

const remotePath = z
  .string()
  .min(1)
  .describe(
    "Path within the zone, e.g. `images/photo.png`. A trailing slash means a directory.",
  );

/** Edge Storage file access needs the zone password, so every file action resolves the zone first. */
async function connect(
  ctx: ActionContext,
  zone: string,
): Promise<{ connection: StorageZoneConnection; name: string }> {
  ctx.progress("Resolving storage zone...");
  const target = await resolveStorageZone(ctx.clients.core, zone, {
    signal: ctx.signal,
  });
  return { connection: connectStorageZone(target), name: target.Name ?? "" };
}

export const storageFilesList = defineAction({
  name: "storage.files.list",
  title: "List files",
  description:
    "List the files and directories at a path inside a storage zone. Not recursive.",
  schema: z.strictObject({
    zone: zoneRef,
    path: z
      .string()
      .default("")
      .describe("Directory to list. Defaults to the zone root."),
  }),
  kind: "read",
  resultSchema: z.array(StorageFileEntrySchema),
  examples: [
    [{ zone: "my-assets" }, "List the zone root"],
    [{ zone: "my-assets", path: "images/" }, "List a directory"],
  ],
  run: async (ctx, input): Promise<StorageFileEntry[]> => {
    const { connection } = await connect(ctx, input.zone);

    ctx.progress("Listing files...");
    const files = await listFiles(connection, input.path);

    return files.map(toStorageFileEntry).sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  },
});

export const UploadedFileSchema = z.object({
  zone: z.string(),
  path: z.string(),
  size: z.number(),
  uploaded: z.literal(true),
});

export type UploadedFile = z.infer<typeof UploadedFileSchema>;

export const storageFilesUpload = defineAction({
  name: "storage.files.upload",
  title: "Upload a file",
  description:
    "Upload a local file to a path inside a storage zone, overwriting whatever is already there.",
  schema: z.strictObject({
    zone: zoneRef,
    source: z.string().min(1).describe("Path to the local file to upload."),
    path: remotePath,
    contentType: z
      .string()
      .optional()
      .describe("Override the stored content type."),
    checksum: z
      .boolean()
      .default(false)
      .describe("Send a SHA256 checksum so the server verifies the upload."),
  }),
  kind: "write",
  resultSchema: UploadedFileSchema,
  localFiles: true,
  examples: [
    [
      { zone: "my-assets", source: "./photo.png", path: "images/photo.png" },
      "Upload a file into a directory",
    ],
  ],
  run: async (ctx, input): Promise<UploadedFile> => {
    const source = await stat(input.source).catch(() => null);
    if (!source?.isFile()) {
      throw new UserError(`File not found: ${input.source}`);
    }

    const { connection, name } = await connect(ctx, input.zone);

    ctx.progress(`Uploading ${input.path}...`);
    const sha256Checksum = input.checksum
      ? await sha256(input.source)
      : undefined;
    const contents = Readable.toWeb(
      createReadStream(input.source),
    ) as ReadableStream<Uint8Array>;
    await uploadFile(connection, input.path, contents, {
      contentType: input.contentType,
      sha256Checksum,
    });

    return { zone: name, path: input.path, size: source.size, uploaded: true };
  },
});

export const DownloadedFileSchema = z.object({
  zone: z.string(),
  path: z.string(),
  destination: z.string().describe("Local path the file was written to."),
  size: z.number(),
});

export type DownloadedFile = z.infer<typeof DownloadedFileSchema>;

export const storageFilesDownload = defineAction({
  name: "storage.files.download",
  title: "Download a file",
  description:
    "Download a file from a storage zone to a local path, creating parent directories as needed.",
  schema: z.strictObject({
    zone: zoneRef,
    path: remotePath,
    destination: z.string().min(1).describe("Local path to write the file to."),
  }),
  kind: "read",
  resultSchema: DownloadedFileSchema,
  localFiles: true,
  examples: [
    [
      {
        zone: "my-assets",
        path: "images/photo.png",
        destination: "./photo.png",
      },
      "Download a file to the working directory",
    ],
  ],
  run: async (ctx, input): Promise<DownloadedFile> => {
    const { connection, name } = await connect(ctx, input.zone);

    ctx.progress(`Downloading ${input.path}...`);
    // Stream to disk so multi-GB objects don't have to fit in memory.
    await mkdir(dirname(input.destination), { recursive: true });
    const { stream } = await downloadFile(connection, input.path);
    let size = 0;
    async function* counted(): AsyncGenerator<Uint8Array> {
      for await (const chunk of stream) {
        size += chunk.byteLength;
        yield chunk;
      }
    }
    try {
      await pipeline(counted(), createWriteStream(input.destination));
    } catch (err) {
      // Don't leave a truncated file behind on a failed download.
      await unlink(input.destination).catch(() => {});
      throw err;
    }

    return {
      zone: name,
      path: input.path,
      destination: input.destination,
      size,
    };
  },
});

export const DeletedFileSchema = z.object({
  zone: z.string(),
  path: z.string(),
  deleted: z.literal(true),
});

export type DeletedFile = z.infer<typeof DeletedFileSchema>;

export const storageFilesDelete = defineAction({
  name: "storage.files.delete",
  title: "Delete a file",
  description:
    "Delete a file from a storage zone. A trailing slash deletes a directory and everything under it.",
  schema: z.strictObject({ zone: zoneRef, path: remotePath }),
  kind: "destructive",
  resultSchema: DeletedFileSchema,
  examples: [
    [{ zone: "my-assets", path: "images/photo.png" }, "Delete one file"],
    [
      { zone: "my-assets", path: "images/" },
      "Delete a directory and its contents",
    ],
  ],
  run: async (ctx, input): Promise<DeletedFile> => {
    const { connection, name } = await connect(ctx, input.zone);

    ctx.progress("Deleting...");
    await deleteFile(connection, input.path);

    return { zone: name, path: input.path, deleted: true };
  },
});

// Hash in a streaming pass to avoid buffering the whole file in memory.
async function sha256(path: string): Promise<string> {
  const hasher = createHash("sha256");
  for await (const chunk of createReadStream(path)) hasher.update(chunk);
  return hasher.digest("hex").toUpperCase();
}

export const storageFileActions: Action[] = [
  storageFilesList,
  storageFilesUpload,
  storageFilesDownload,
  storageFilesDelete,
];
