import indexHtml from "../dist/client/index.html" with { type: "file" };
import indexJs from "../dist/client/assets/index.js" with { type: "file" };
import indexCss from "../dist/client/assets/index.css" with { type: "file" };

// `with { type: "file" }` resolves to a file path string at runtime, but Bun's
// ambient `*.html` declaration types it as `HTMLBundle`. Cast to string.
export const assets: Record<string, string> = {
  "/index.html": indexHtml as unknown as string,
  "/assets/index.js": indexJs,
  "/assets/index.css": indexCss,
};
