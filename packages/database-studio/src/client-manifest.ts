import indexHtml from "../dist/client/index.html" with { type: "file" };
import indexJs from "../dist/client/assets/index.js" with { type: "file" };
import indexCss from "../dist/client/assets/index.css" with { type: "file" };

export const assets: Record<string, string> = {
  "/index.html": indexHtml,
  "/assets/index.js": indexJs,
  "/assets/index.css": indexCss,
};
