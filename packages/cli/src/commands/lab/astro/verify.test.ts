import { expect, test } from "bun:test";
import { isBunnyErrorPage } from "./verify.ts";

// The check exists because a pull zone with no error page of its own answers a
// miss with bunny.net's, whatever the build produced. Astro renders its own 404,
// so bunny.net's page here means the request never reached the script.
test("bunny.net's own error page is recognised", () => {
  expect(
    isBunnyErrorPage(
      "<html><body><h1>bunny.net</h1><p>An error has occurred.</p></body></html>",
    ),
  ).toBe(true);
  // The order of the two markers is not the signal, so either way round counts.
  expect(
    isBunnyErrorPage(
      "<html><body><p>An error has occurred.</p><footer>bunny.net</footer></body></html>",
    ),
  ).toBe(true);
});

// A page the site built that happens to name its host is the site's page.
test("a site's own page that mentions its host is not an error page", () => {
  expect(isBunnyErrorPage("<h1>Hosted on bunny.net</h1><p>Welcome.</p>")).toBe(
    false,
  );
});

// A site about rabbits is not a broken site.
test("a page that merely mentions bunnies is not an error page", () => {
  expect(isBunnyErrorPage("<h1>Bunny facts</h1><p>They hop.</p>")).toBe(false);
});

test("Astro's own 404 page is not mistaken for bunny.net's", () => {
  const astro = `<!doctype html><html><head><title>404: Not Found</title></head>
    <body><h1>404: Not Found</h1><p>This page does not exist.</p></body></html>`;
  expect(isBunnyErrorPage(astro)).toBe(false);
});
