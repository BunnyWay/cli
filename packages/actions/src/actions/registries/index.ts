import { UserError } from "@bunny.net/openapi-client";
import { z } from "zod";
import type { Action } from "../../define-action.ts";
import { defineAction } from "../../define-action.ts";
import {
  fetchRegistries,
  fetchRegistry,
  registryTypeForServer,
  requireSaved,
} from "./api.ts";
import { type Registry, RegistrySchema, toRegistry } from "./model.ts";

const registryRef = z
  .number()
  .int()
  .positive()
  .describe("Registry ID, e.g. `1155`.");

// The API omits "generic"; leaving `type` unset is what generic means.
const registryType = z
  .enum(["dockerHub", "gitHub"])
  .optional()
  .describe(
    "Registry type. Required as `gitHub` for ghcr.io and `dockerHub` for docker.io; omit for a generic registry.",
  );

export const registriesList = defineAction({
  name: "registries.list",
  title: "List container registries",
  description:
    "List the container registries configured on the account, used by Magic Containers apps to pull private images.",
  schema: z.strictObject({}),
  kind: "read",
  resultSchema: z.array(RegistrySchema),
  run: async (ctx): Promise<Registry[]> => {
    ctx.progress("Fetching registries...");
    const registries = await fetchRegistries(ctx.clients.mc, {
      signal: ctx.signal,
    });
    return registries.map(toRegistry);
  },
});

export const registriesGet = defineAction({
  name: "registries.get",
  title: "Get a container registry",
  description: "Get one container registry by ID.",
  schema: z.strictObject({ registry: registryRef }),
  kind: "read",
  resultSchema: RegistrySchema,
  examples: [[{ registry: 1155 }, "Show one registry"]],
  run: async (ctx, { registry }): Promise<Registry> => {
    ctx.progress("Fetching registry...");
    return toRegistry(
      await fetchRegistry(ctx.clients.mc, registry, { signal: ctx.signal }),
    );
  },
});

export const registriesCreate = defineAction({
  name: "registries.create",
  title: "Add a container registry",
  description:
    "Add a container registry with pull credentials. The password is stored by bunny.net and never returned; the type must match the registry host (gitHub for ghcr.io).",
  schema: z.strictObject({
    name: z.string().min(1).describe("Display name for the registry."),
    username: z.string().min(1).describe("Registry username."),
    password: z.string().min(1).describe("Registry password or access token."),
    type: registryType,
    server: z
      .string()
      .optional()
      .describe(
        "Registry server, e.g. `ghcr.io`. Used to derive `type` when it is omitted.",
      ),
  }),
  kind: "write",
  examples: [
    [
      {
        name: "ghcr.io (notrab)",
        username: "notrab",
        password: "ghp_...",
        server: "ghcr.io",
      },
      "Add a GitHub container registry",
    ],
  ],
  resultSchema: RegistrySchema,
  run: async (ctx, input): Promise<Registry> => {
    ctx.progress("Adding registry...");
    const { data } = await ctx.clients.mc.POST("/registries", {
      body: {
        displayName: input.name,
        type: input.type ?? registryTypeForServer(input.server),
        passwordCredentials: {
          userName: input.username,
          password: input.password,
        },
      },
      signal: ctx.signal,
    });
    requireSaved(data, "add");

    ctx.progress("Fetching registry...");
    return toRegistry(
      await fetchRegistry(ctx.clients.mc, data.id ?? 0, {
        signal: ctx.signal,
      }),
    );
  },
});

export const registriesUpdate = defineAction({
  name: "registries.update",
  title: "Update a container registry",
  description:
    "Rename a container registry and/or rotate its credentials. Fields left out keep their current value; username and password rotate together.",
  schema: z.strictObject({
    registry: registryRef,
    name: z
      .string()
      .min(1)
      .optional()
      .describe("New display name. Omit to keep the current one."),
    username: z
      .string()
      .optional()
      .describe("New registry username. Requires password."),
    password: z
      .string()
      .optional()
      .describe("New registry password or token. Requires username."),
    type: registryType,
  }),
  kind: "write",
  resultSchema: RegistrySchema,
  examples: [
    [
      { registry: 1155, username: "notrab", password: "ghp_..." },
      "Rotate the credentials",
    ],
    [{ registry: 1155, name: "ghcr.io (notrab)" }, "Rename only"],
  ],
  run: async (ctx, input): Promise<Registry> => {
    if (Boolean(input.username) !== Boolean(input.password)) {
      throw new UserError(
        "Username and password must be rotated together.",
        "Pass both to change the credentials, or neither to keep them.",
      );
    }

    ctx.progress("Fetching registry...");
    const existing = await fetchRegistry(ctx.clients.mc, input.registry, {
      signal: ctx.signal,
    });

    ctx.progress("Updating registry...");
    const { data } = await ctx.clients.mc.PUT("/registries/{registryId}", {
      params: { path: { registryId: input.registry } },
      body: {
        displayName: input.name ?? existing.displayName ?? "",
        ...(input.type ? { type: input.type } : {}),
        ...(input.username && input.password
          ? {
              passwordCredentials: {
                userName: input.username,
                password: input.password,
              },
            }
          : {}),
      },
      signal: ctx.signal,
    });
    requireSaved(data, "update");

    ctx.progress("Fetching updated registry...");
    return toRegistry(
      await fetchRegistry(ctx.clients.mc, input.registry, {
        signal: ctx.signal,
      }),
    );
  },
});

export const DeletedRegistrySchema = z.object({
  id: z.number(),
  deleted: z.literal(true),
});

export type DeletedRegistry = z.infer<typeof DeletedRegistrySchema>;

export const registriesDelete = defineAction({
  name: "registries.delete",
  title: "Remove a container registry",
  description:
    "Remove a container registry. Fails when the registry is still used by an app.",
  schema: z.strictObject({ registry: registryRef }),
  kind: "destructive",
  resultSchema: DeletedRegistrySchema,
  examples: [[{ registry: 1155 }, "Remove a registry"]],
  run: async (ctx, { registry }): Promise<DeletedRegistry> => {
    ctx.progress("Removing registry...");
    const { data } = await ctx.clients.mc.DELETE("/registries/{registryId}", {
      params: { path: { registryId: registry } },
      signal: ctx.signal,
    });

    if (data?.status === "inUse") {
      throw new UserError(
        "Registry is in use by one or more apps.",
        `Apps using this registry: ${data.applications?.join(", ") ?? "unknown"}.`,
      );
    }
    if (data?.status === "notFound") {
      throw new UserError(`Registry ${registry} not found.`);
    }

    return { id: registry, deleted: true };
  },
});

export const registriesActions: Action[] = [
  registriesList,
  registriesGet,
  registriesCreate,
  registriesUpdate,
  registriesDelete,
];
