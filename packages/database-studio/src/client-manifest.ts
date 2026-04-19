import indexCss from "../dist/client/assets/index.css" with { type: "file" };
import indexJs from "../dist/client/assets/index.js" with { type: "file" };
import indexHtml from "../dist/client/index.html" with { type: "file" };

// `with { type: "file" }` resolves to a file path string at runtime, but TS
// resolves the real module when the built artifact exists on disk (overriding
// the ambient `*.js`/`*.html` declarations), so cast through `unknown`.
export const assets: Record<string, string> = {
  "/index.html": indexHtml as unknown as string,
  "/assets/index.js": indexJs as unknown as string,
  "/assets/index.css": indexCss,
};
