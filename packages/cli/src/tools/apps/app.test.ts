import { expect, test } from "bun:test";
import { createToolContext, type McClient } from "@/tools/context.ts";
import { appsList } from "./app.ts";

test("apps.list sorts by name and drops apps without an ID", async () => {
  const mc = {
    GET: (path: string) => {
      expect(path).toBe("/apps");
      return Promise.resolve({
        data: {
          items: [
            { id: "app-z", name: "zeta", status: "active" },
            { name: "orphan" },
            { id: "app-a", name: "alpha", status: "failing" },
            { id: "app-n" },
          ],
          cursor: null,
        },
      });
    },
  } as unknown as McClient;

  expect(
    await appsList.invoke(createToolContext({ clients: { mc } }), {}),
  ).toEqual([
    { id: "app-a", name: "alpha", status: "failing" },
    { id: "app-n", name: "app-n", status: undefined },
    { id: "app-z", name: "zeta", status: "active" },
  ]);
});
