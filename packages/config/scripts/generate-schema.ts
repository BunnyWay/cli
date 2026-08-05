import { z } from "zod";
import { BunnyConfigSchema } from "../src/schema.ts";

const jsonSchema = z.toJSONSchema(BunnyConfigSchema, {
  target: "draft-2020-12",
});

const output = `${JSON.stringify(jsonSchema, null, 2)}\n`;

await Bun.write(new URL("../generated/schema.json", import.meta.url), output);

console.log("Generated schema.json");
