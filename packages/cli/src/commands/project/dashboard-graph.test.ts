import { describe, expect, test } from "bun:test";
import { buildProjectGraph } from "./dashboard-graph.ts";

describe("buildProjectGraph", () => {
  test("maps bindings to nodes with edges from the project", () => {
    const graph = buildProjectGraph({
      version: "2026-06-10",
      name: "acme",
      databases: { db: { id: "db_1", name: "acme-db" } },
      scripts: {
        api: {
          id: 7,
          name: "acme-api",
          type: "standalone",
          entry: "src/index.ts",
        },
      },
    });

    expect(graph.name).toBe("acme");
    expect(graph.nodes.map((n) => n.id)).toEqual([
      "project",
      "database:db",
      "script:api",
    ]);
    expect(graph.edges).toEqual([
      { from: "project", to: "database:db" },
      { from: "project", to: "script:api" },
    ]);

    const script = graph.nodes.find((n) => n.id === "script:api");
    expect(script?.details).toEqual([
      { key: "id", value: "7" },
      { key: "type", value: "standalone" },
      { key: "entry", value: "src/index.ts" },
    ]);
  });

  test("nests app containers under an app node", () => {
    const graph = buildProjectGraph({
      version: "2026-05-11",
      app: {
        name: "storefront",
        scaling: { min: 1, max: 3 },
        containers: {
          web: { dockerfile: "Dockerfile", env: { PORT: "3000" } },
          cache: { image: "redis:7" },
        },
      },
    });

    expect(graph.name).toBe("storefront");
    expect(graph.edges).toEqual([
      { from: "project", to: "app" },
      { from: "app", to: "container:web" },
      { from: "app", to: "container:cache" },
    ]);

    const app = graph.nodes.find((n) => n.id === "app");
    expect(app?.details).toEqual([{ key: "scaling", value: "1–3" }]);
    const web = graph.nodes.find((n) => n.id === "container:web");
    expect(web?.details).toEqual([
      { key: "dockerfile", value: "Dockerfile" },
      { key: "env", value: "1" },
    ]);
  });

  test("handles an empty map", () => {
    const graph = buildProjectGraph({ version: "2026-06-10", name: "bare" });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toEqual([]);
  });
});
