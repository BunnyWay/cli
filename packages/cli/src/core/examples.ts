/** Runnable example apps, one folder per product: https://github.com/BunnyWay/examples */
const EXAMPLES_REPO = "https://github.com/BunnyWay/examples";

export type ExamplesProduct = "cdn" | "sites" | "storage" | "stream";

export function examplesUrl(product: ExamplesProduct): string {
  return `${EXAMPLES_REPO}/tree/main/${product}`;
}
