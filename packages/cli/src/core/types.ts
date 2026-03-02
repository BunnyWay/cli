export type OutputFormat = "text" | "json" | "table" | "csv" | "markdown";

export interface GlobalArgs {
  profile: string;
  verbose: boolean;
  output: OutputFormat;
  apiKey?: string;
}
