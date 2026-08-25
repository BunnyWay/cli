import node from "@astrojs/node";
import { defineConfig } from "astro/config";

export default defineConfig({
  // Server output: the notes endpoint has to run per request, not at build time.
  output: "server",
  adapter: node({ mode: "standalone" }),
});
