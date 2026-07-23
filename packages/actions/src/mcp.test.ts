import { expect, test } from "bun:test";
import { actionForToolName, toMcpTool, toMcpTools } from "./mcp.ts";
import { actions, getAction } from "./registry.ts";

const MCP_NAME = /^[a-zA-Z0-9_-]{1,128}$/;

test("every action converts to a valid MCP tool", () => {
  const tools = toMcpTools();
  expect(tools).toHaveLength(actions.length);

  for (const tool of tools) {
    expect(tool.name).toMatch(MCP_NAME);
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.description.length).toBeGreaterThan(10);
  }
});

test("annotations mirror the destructive flag", () => {
  const del = toMcpTool(getAction("storage.zones.delete")!);
  expect(del.name).toBe("bunny_storage_zones_delete");
  expect(del.annotations).toMatchObject({
    readOnlyHint: false,
    destructiveHint: true,
  });

  const list = toMcpTool(getAction("storage.zones.list")!);
  expect(list.annotations).toMatchObject({
    readOnlyHint: true,
    destructiveHint: false,
  });
});

test("input schemas carry field descriptions and reject unknown keys", () => {
  const schema = toMcpTool(getAction("storage.zones.get")!).inputSchema as {
    properties: Record<string, { description?: string }>;
    required: string[];
    additionalProperties: boolean;
  };
  expect(schema.properties.zone?.description).toContain("name or numeric ID");
  expect(schema.required).toEqual(["zone"]);
  expect(schema.additionalProperties).toBe(false);
});

test("region choices reach the tool schema as an enum", () => {
  const schema = toMcpTool(getAction("storage.zones.create")!).inputSchema as {
    properties: { region: { enum: string[] } };
  };
  expect(schema.properties.region.enum).toContain("DE");
});

test("tool names round-trip back to their action", () => {
  for (const action of actions) {
    const tool = toMcpTool(action);
    expect(actionForToolName(tool.name)?.name).toBe(action.name);
  }
  expect(actionForToolName("bunny_not_a_tool")).toBeUndefined();
});

test("a custom prefix applies to both directions", () => {
  const [tool] = toMcpTools({ prefix: "bn", actions: [actions[0]!] });
  expect(tool?.name.startsWith("bn_")).toBe(true);
  expect(actionForToolName(tool!.name, { prefix: "bn" })?.name).toBe(
    actions[0]?.name,
  );
});
