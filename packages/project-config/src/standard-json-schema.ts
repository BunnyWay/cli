/** Consumer-side types for Standard JSON Schema v1 (https://standardschema.dev/json-schema). */

export type StandardJSONSchemaTarget =
  | "draft-2020-12"
  | "draft-07"
  | "openapi-3.0"
  | ({} & string);

export interface StandardJSONSchemaOptions {
  readonly target: StandardJSONSchemaTarget;
  readonly libraryOptions?: Record<string, unknown> | undefined;
}

export interface StandardJSONSchemaConverter {
  input(options: StandardJSONSchemaOptions): Record<string, unknown>;
  output(options: StandardJSONSchemaOptions): Record<string, unknown>;
}

/** `jsonSchema` is optional here so the helper accepts any Standard Schema and reports support itself. */
export interface StandardJSONSchemaV1 {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly jsonSchema?: StandardJSONSchemaConverter;
  };
}

/** Convert any Standard JSON Schema-capable schema (Zod, ArkType, ...) to a JSON Schema document. */
export function toJSONSchema(
  schema: StandardJSONSchemaV1,
  options: StandardJSONSchemaOptions = { target: "draft-2020-12" },
): Record<string, unknown> {
  const std = schema["~standard"];
  if (!std.jsonSchema) {
    throw new Error(
      `Schema vendor "${std.vendor}" does not implement Standard JSON Schema.`,
    );
  }
  return std.jsonSchema.input(options);
}
