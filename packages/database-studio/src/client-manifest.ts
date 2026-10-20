import indexCss from "../dist/client/assets/index.css" with { type: "file" };
import indexJs from "../dist/client/assets/index.js" with { type: "file" };
import indexHtml from "../dist/client/index.html" with { type: "file" };

// These are file paths at runtime; TS sees the real modules once the build exists.
export const assets: Record<string, string> = {
  "/index.html": indexHtml as unknown as string,
  "/assets/index.js": indexJs as unknown as string,
  "/assets/index.css": indexCss,
};
