import { z } from "zod";
import type { Tool } from "../define-tool.ts";
import { defineTool } from "../define-tool.ts";
import { fetchNamespace, qualifyRepository, stripNamespace } from "./client.ts";

export type { RegistryClient, RegistryEndpoint } from "./client.ts";
export {
  basicAuthHeader,
  createRegistryClient,
  DEFAULT_REGISTRY_URL,
  fetchNamespace,
  parseRegistryUrl,
  qualifyRepository,
  REGISTRY_USERNAME,
  stripNamespace,
} from "./client.ts";

interface Catalog {
  repositories?: string[];
}

interface TagList {
  tags?: string[];
}

export const registryRepositories = defineTool({
  name: "registry.repositories",
  title: "List registry repositories",
  description:
    "List the image repositories in the bunny.net container registry. Names are returned without the account prefix the registry stores them under.",
  schema: z.strictObject({}),
  kind: "read",
  resultSchema: z.array(z.string()),
  run: async (ctx): Promise<string[]> => {
    ctx.progress("Fetching repositories...");
    const [catalog, namespace] = await Promise.all([
      ctx.clients.registry.get<Catalog>("/v2/_catalog", {
        signal: ctx.signal,
      }),
      fetchNamespace(ctx.clients.core, { signal: ctx.signal }),
    ]);
    return (catalog.repositories ?? [])
      .map((repository) => stripNamespace(repository, namespace))
      .sort((a, b) => a.localeCompare(b));
  },
});

export const RepositoryTagsSchema = z.object({
  repository: z.string(),
  tags: z.array(z.string()),
});

export type RepositoryTags = z.infer<typeof RepositoryTagsSchema>;

export const registryTags = defineTool({
  name: "registry.tags",
  title: "List repository tags",
  description:
    "List the tags published for one repository in the bunny.net container registry.",
  schema: z.strictObject({
    repository: z
      .string()
      .min(1)
      .describe(
        "Repository name as shown by `registry.repositories`, e.g. `myapp`. The account prefix is added for you.",
      ),
  }),
  kind: "read",
  resultSchema: RepositoryTagsSchema,
  examples: [[{ repository: "myapp" }, "List the tags for myapp"]],
  run: async (ctx, { repository }): Promise<RepositoryTags> => {
    ctx.progress(`Fetching tags for ${repository}...`);
    const namespace = await fetchNamespace(ctx.clients.core, {
      signal: ctx.signal,
    });
    const qualified = qualifyRepository(repository, namespace);
    const result = await ctx.clients.registry.get<TagList>(
      `/v2/${qualified}/tags/list`,
      { signal: ctx.signal },
    );
    return {
      repository: stripNamespace(qualified, namespace),
      tags: result.tags ?? [],
    };
  },
});

export const registryTools: Tool[] = [registryRepositories, registryTags];
