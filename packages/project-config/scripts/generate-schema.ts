import { BunnyProjectConfigSchema } from "../src/schema.ts";
import { toJSONSchema } from "../src/standard-json-schema.ts";

// Consumed via the Standard JSON Schema interface, not Zod-specific APIs.
const jsonSchema = toJSONSchema(BunnyProjectConfigSchema, {
  target: "draft-2020-12",
});

const output = `${JSON.stringify(jsonSchema, null, 2)}\n`;

await Bun.write(new URL("../generated/schema.json", import.meta.url), output);

console.log("Generated schema.json");
