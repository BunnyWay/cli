import type { BunnyProjectConfig } from "@bunny.net/project-config";

export type GraphNodeKind =
  | "project"
  | "database"
  | "script"
  | "app"
  | "container";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  sublabel?: string;
  details: { key: string; value: string }[];
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface ProjectGraph {
  name: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Flatten a bunny.jsonc config into the node/edge model the canvas renders. */
export function buildProjectGraph(config: BunnyProjectConfig): ProjectGraph {
  const name = config.name ?? config.app?.name ?? "untitled project";
  const nodes: GraphNode[] = [
    { id: "project", kind: "project", label: name, details: [] },
  ];
  const edges: GraphEdge[] = [];

  for (const [binding, db] of Object.entries(config.databases ?? {})) {
    nodes.push({
      id: `database:${binding}`,
      kind: "database",
      label: binding,
      sublabel: db.name,
      details: [{ key: "id", value: db.id }],
    });
    edges.push({ from: "project", to: `database:${binding}` });
  }

  for (const [binding, script] of Object.entries(config.scripts ?? {})) {
    const details = [{ key: "id", value: String(script.id) }];
    if (script.type) details.push({ key: "type", value: script.type });
    if (script.entry) details.push({ key: "entry", value: script.entry });
    nodes.push({
      id: `script:${binding}`,
      kind: "script",
      label: binding,
      sublabel: script.name,
      details,
    });
    edges.push({ from: "project", to: `script:${binding}` });
  }

  if (config.app) {
    const details: GraphNode["details"] = [];
    if (config.app.scaling) {
      details.push({
        key: "scaling",
        value: `${config.app.scaling.min}–${config.app.scaling.max}`,
      });
    }
    nodes.push({
      id: "app",
      kind: "app",
      label: config.app.name,
      sublabel: "Magic Containers",
      details,
    });
    edges.push({ from: "project", to: "app" });

    for (const [containerName, container] of Object.entries(
      config.app.containers,
    )) {
      const containerDetails: GraphNode["details"] = [];
      if (container.image)
        containerDetails.push({ key: "image", value: container.image });
      if (container.dockerfile)
        containerDetails.push({
          key: "dockerfile",
          value: container.dockerfile,
        });
      if (container.endpoints?.length)
        containerDetails.push({
          key: "endpoints",
          value: String(container.endpoints.length),
        });
      const envCount = Object.keys(container.env ?? {}).length;
      if (envCount > 0)
        containerDetails.push({ key: "env", value: String(envCount) });

      nodes.push({
        id: `container:${containerName}`,
        kind: "container",
        label: containerName,
        details: containerDetails,
      });
      edges.push({ from: "app", to: `container:${containerName}` });
    }
  }

  return { name, nodes, edges };
}
