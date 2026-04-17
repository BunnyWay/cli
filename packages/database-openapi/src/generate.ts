import type {
  ColumnDefinition,
  DatabaseSchema,
  GenerateOptions,
  TableDefinition,
} from "./types.ts";

interface TagObject {
  name: string;
  description?: string;
}

interface ReferenceObject {
  $ref: string;
}

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  tags?: TagObject[];
  paths: Record<string, PathItem>;
  components: {
    schemas: Record<string, SchemaObject>;
    parameters: Record<string, ParameterObject>;
  };
}

export interface PathItem {
  get?: OperationObject;
  post?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
}

export interface OperationObject {
  summary: string;
  operationId: string;
  tags: string[];
  parameters?: (ParameterObject | ReferenceObject)[];
  requestBody?: RequestBodyObject;
  responses: Record<string, ResponseObject>;
}

export interface ParameterObject {
  name: string;
  in: "query" | "path" | "header";
  description?: string;
  required?: boolean;
  schema: SchemaObject;
}

interface RequestBodyObject {
  required: boolean;
  content: {
    "application/json": {
      schema: SchemaObject;
    };
  };
}

interface ResponseObject {
  description: string;
  content?: {
    "application/json": {
      schema: SchemaObject;
    };
  };
}

export interface SchemaObject {
  type?: string;
  format?: string;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  required?: string[];
  $ref?: string;
  oneOf?: SchemaObject[];
  nullable?: boolean;
  example?: unknown;
}

const NAME_EXAMPLES: [RegExp, unknown][] = [
  [/^e?mail$/i, "user@example.com"],
  [/^(full_?)?name$/i, "John Doe"],
  [/^first_?name$/i, "John"],
  [/^last_?name$/i, "Doe"],
  [/^user_?name$/i, "johndoe"],
  [/^phone|mobile|tel$/i, "+1-555-0123"],
  [/^(url|website|homepage|link)$/i, "https://example.com"],
  [/^(image|photo|avatar|icon|logo|thumbnail)(_url)?$/i, "https://example.com/image.png"],
  [/^(title|subject|headline)$/i, "Hello World"],
  [/^(description|summary|bio|about)$/i, "A short description"],
  [/^(body|content|text|message)$/i, "Lorem ipsum dolor sit amet"],
  [/^(slug)$/i, "hello-world"],
  [/^(city)$/i, "San Francisco"],
  [/^(country)$/i, "US"],
  [/^(zip|postal)(_?code)?$/i, "94102"],
  [/^(address|street)$/i, "123 Main St"],
  [/^(state|province|region)$/i, "CA"],
  [/^(currency)$/i, "USD"],
  [/^(lang|language|locale)$/i, "en"],
  [/^(ip|ip_?address)$/i, "192.168.1.1"],
  [/^(price|amount|cost|total|balance)$/i, 9.99],
  [/^(age)$/i, 25],
  [/^(count|quantity|qty)$/i, 10],
  [/^(rating|score)$/i, 4.5],
  [/^(lat|latitude)$/i, 37.7749],
  [/^(lng|lon|longitude)$/i, -122.4194],
  [/^(weight)$/i, 1.5],
  [/^(height|width|depth|length|size)$/i, 100],
  [/^(sort|position|order|rank|priority)$/i, 1],
];

const columnExample = (column: ColumnDefinition): unknown | undefined => {
  const name = column.name;

  for (const [pattern, example] of NAME_EXAMPLES) {
    if (pattern.test(name)) {
      return example;
    }
  }

  if (/_(at|date|time|on)$/.test(name) || /^(date|time|timestamp)$/i.test(name)) {
    return "2024-01-01T00:00:00Z";
  }

  if (/_(id|ID)$/.test(name)) {
    return 1;
  }

  switch (column.type) {
    case "INTEGER":
      return 1;
    case "REAL":
      return 1.5;
    case "BOOLEAN":
      return true;
    case "DATETIME":
      return "2024-01-01T00:00:00Z";
    case "TEXT":
      return "string";
    case "BLOB":
      return undefined;
    default:
      return undefined;
  }
};

const columnTypeToSchema = (column: ColumnDefinition): SchemaObject => {
  const base: SchemaObject = {};

  switch (column.type) {
    case "INTEGER":
      base.type = "integer";
      break;
    case "REAL":
      base.type = "number";
      base.format = "double";
      break;
    case "BOOLEAN":
      base.type = "boolean";
      break;
    case "DATETIME":
      base.type = "string";
      base.format = "date-time";
      break;
    case "BLOB":
      base.type = "string";
      base.format = "binary";
      break;
    case "TEXT":
    default:
      base.type = "string";
      break;
  }

  if (column.nullable) {
    base.nullable = true;
  }

  const example = columnExample(column);
  if (example !== undefined) {
    base.example = example;
  }

  return base;
};

const tableToSchema = (table: TableDefinition): SchemaObject => {
  const properties: Record<string, SchemaObject> = {};
  const required: string[] = [];

  for (const column of table.columns) {
    properties[column.name] = columnTypeToSchema(column);
    if (!column.nullable && column.defaultValue === undefined && !column.primaryKey) {
      required.push(column.name);
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
};

const tableToInsertSchema = (table: TableDefinition): SchemaObject => {
  const properties: Record<string, SchemaObject> = {};
  const required: string[] = [];

  for (const column of table.columns) {
    if (column.primaryKey && column.type === "INTEGER") {
      continue;
    }
    properties[column.name] = columnTypeToSchema(column);
    if (!column.nullable && column.defaultValue === undefined) {
      required.push(column.name);
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
};

const tableToUpdateSchema = (table: TableDefinition): SchemaObject => {
  const properties: Record<string, SchemaObject> = {};

  for (const column of table.columns) {
    if (column.primaryKey) continue;
    properties[column.name] = columnTypeToSchema(column);
  }

  return {
    type: "object",
    properties,
  };
};

const generateFilterParams = (table: TableDefinition): ParameterObject[] =>
  table.columns.map((column) => ({
    name: column.name,
    in: "query" as const,
    description: `Filter by ${column.name} (e.g., eq.value, neq.value, gt.value, gte.value, lt.value, lte.value, like.pattern, in.(a,b,c))`,
    required: false,
    schema: { type: "string" },
  }));

const ERROR_RESPONSE_400: ResponseObject = {
  description: "Bad request",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" },
    },
  },
};

const ERROR_RESPONSE_404: ResponseObject = {
  description: "Not found",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" },
    },
  },
};

const COMMON_PARAM_REFS: ReferenceObject[] = [
  { $ref: "#/components/parameters/select" },
  { $ref: "#/components/parameters/order" },
  { $ref: "#/components/parameters/limit" },
  { $ref: "#/components/parameters/offset" },
];

const capitalize = (str: string): string =>
  str.charAt(0).toUpperCase() + str.slice(1);

const listResponse = (table: TableDefinition, description: string): ResponseObject => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          data: {
            type: "array",
            items: { $ref: `#/components/schemas/${table.name}` },
          },
        },
      },
    },
  },
});

const singleResponse = (table: TableDefinition, description: string): ResponseObject => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          data: { $ref: `#/components/schemas/${table.name}` },
        },
      },
    },
  },
});

const updateBody = (table: TableDefinition): RequestBodyObject => ({
  required: true,
  content: {
    "application/json": {
      schema: { $ref: `#/components/schemas/${table.name}Update` },
    },
  },
});

const generateListOperation = (table: TableDefinition, filterParams: ParameterObject[]): OperationObject => ({
  summary: `List ${table.name}`,
  operationId: `get${capitalize(table.name)}`,
  tags: [table.name],
  parameters: [...COMMON_PARAM_REFS, ...filterParams],
  responses: {
    "200": listResponse(table, "Successful response"),
    "400": ERROR_RESPONSE_400,
    "404": ERROR_RESPONSE_404,
  },
});

const generateCreateOperation = (table: TableDefinition): OperationObject => ({
  summary: `Create ${table.name}`,
  operationId: `create${capitalize(table.name)}`,
  tags: [table.name],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          oneOf: [
            { $ref: `#/components/schemas/${table.name}Insert` },
            {
              type: "array",
              items: { $ref: `#/components/schemas/${table.name}Insert` },
            },
          ],
        },
      },
    },
  },
  responses: {
    "201": listResponse(table, "Created"),
    "400": ERROR_RESPONSE_400,
  },
});

const generateBulkUpdateOperation = (table: TableDefinition, filterParams: ParameterObject[]): OperationObject => ({
  summary: `Update ${table.name}`,
  operationId: `update${capitalize(table.name)}`,
  tags: [table.name],
  parameters: filterParams,
  requestBody: updateBody(table),
  responses: {
    "200": listResponse(table, "Updated"),
    "400": ERROR_RESPONSE_400,
    "404": ERROR_RESPONSE_404,
  },
});

const generateBulkDeleteOperation = (table: TableDefinition, filterParams: ParameterObject[]): OperationObject => ({
  summary: `Delete ${table.name}`,
  operationId: `delete${capitalize(table.name)}`,
  tags: [table.name],
  parameters: filterParams,
  responses: {
    "200": listResponse(table, "Deleted"),
    "400": ERROR_RESPONSE_400,
    "404": ERROR_RESPONSE_404,
  },
});

const generateGetByPkOperation = (table: TableDefinition, pkName: string, pkParam: ParameterObject): OperationObject => ({
  summary: `Get ${table.name} by ${pkName}`,
  operationId: `get${capitalize(table.name)}By${capitalize(pkName)}`,
  tags: [table.name],
  parameters: [pkParam, { $ref: "#/components/parameters/select" }],
  responses: {
    "200": singleResponse(table, "Successful response"),
    "404": ERROR_RESPONSE_404,
  },
});

const generateUpdateByPkOperation = (table: TableDefinition, pkName: string, pkParam: ParameterObject): OperationObject => ({
  summary: `Update ${table.name} by ${pkName}`,
  operationId: `update${capitalize(table.name)}By${capitalize(pkName)}`,
  tags: [table.name],
  parameters: [pkParam],
  requestBody: updateBody(table),
  responses: {
    "200": singleResponse(table, "Updated"),
    "400": ERROR_RESPONSE_400,
    "404": ERROR_RESPONSE_404,
  },
});

const generateDeleteByPkOperation = (table: TableDefinition, pkName: string, pkParam: ParameterObject): OperationObject => ({
  summary: `Delete ${table.name} by ${pkName}`,
  operationId: `delete${capitalize(table.name)}By${capitalize(pkName)}`,
  tags: [table.name],
  parameters: [pkParam],
  responses: {
    "200": singleResponse(table, "Deleted"),
    "404": ERROR_RESPONSE_404,
  },
});

const generateSingleResourcePathItem = (table: TableDefinition): PathItem | null => {
  if (table.primaryKey.length !== 1) return null;

  const pkName = table.primaryKey[0]!;
  const pkColumn = table.columns.find((c) => c.name === pkName);
  if (!pkColumn) return null;

  const pkParam: ParameterObject = {
    name: pkName,
    in: "path",
    required: true,
    description: `${capitalize(table.name)} ${pkName}`,
    schema: columnTypeToSchema({ ...pkColumn, nullable: false }),
  };

  return {
    get: generateGetByPkOperation(table, pkName, pkParam),
    patch: generateUpdateByPkOperation(table, pkName, pkParam),
    delete: generateDeleteByPkOperation(table, pkName, pkParam),
  };
};

const generatePathItem = (table: TableDefinition): PathItem => {
  const filterParams = generateFilterParams(table);

  return {
    get: generateListOperation(table, filterParams),
    post: generateCreateOperation(table),
    patch: generateBulkUpdateOperation(table, filterParams),
    delete: generateBulkDeleteOperation(table, filterParams),
  };
};

export const generateOpenAPISpec = (
  schema: DatabaseSchema,
  options: GenerateOptions = {},
): OpenAPISpec => {
  const paths: Record<string, PathItem> = {};
  const schemas: Record<string, SchemaObject> = {};
  const tags: TagObject[] = [];

  for (const [tableName, table] of Object.entries(schema.tables)) {
    paths[`/${tableName}`] = generatePathItem(table);

    const singlePath = generateSingleResourcePathItem(table);
    if (singlePath) {
      const pkName = table.primaryKey[0]!;
      paths[`/${tableName}/{${pkName}}`] = singlePath;
    }

    schemas[tableName] = tableToSchema(table);
    schemas[`${tableName}Insert`] = tableToInsertSchema(table);
    schemas[`${tableName}Update`] = tableToUpdateSchema(table);
    tags.push({
      name: tableName,
      description: `Operations on ${tableName}`,
    });
  }

  schemas["Error"] = {
    type: "object",
    properties: {
      message: { type: "string", example: "Something went wrong" },
      code: { type: "string", example: "BAD_REQUEST" },
    },
    required: ["message"],
  };

  return {
    openapi: "3.0.3",
    info: {
      title: options.title ?? "Database REST API",
      version: options.version ?? schema.version,
      description: options.description ?? "Auto-generated REST API for your database",
    },
    ...(tags.length > 0 ? { tags } : {}),
    paths,
    components: {
      schemas,
      parameters: {
        select: {
          name: "select",
          in: "query",
          description: "Columns to return (comma-separated)",
          schema: { type: "string" },
        },
        order: {
          name: "order",
          in: "query",
          description: "Sort order (e.g., column.asc, column.desc)",
          schema: { type: "string" },
        },
        limit: {
          name: "limit",
          in: "query",
          description: "Maximum number of rows to return",
          schema: { type: "integer" },
        },
        offset: {
          name: "offset",
          in: "query",
          description: "Number of rows to skip",
          schema: { type: "integer" },
        },
      },
    },
  };
};
