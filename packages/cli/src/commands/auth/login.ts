import { randomBytes } from "node:crypto";
import { createCoreClient } from "@bunny.net/api";
import {
  profileExists,
  resolveConfig,
  setProfile,
} from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { logger } from "../../core/logger.ts";
import { confirm, openBrowser, spinner } from "../../core/ui.ts";

const DASHBOARD_URL =
  process.env.BUNNYNET_DASHBOARD_URL ?? "https://dash.bunny.net";
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

const SUCCESS_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>bunny.net CLI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      display: flex; justify-content: center; align-items: center;
      min-height: 100vh;
      background: linear-gradient(180deg, #e1f2ff 0%, #fff 77.69%);
      padding: 2.8572rem;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .card {
      border: 1px solid #e6e9ec; border-radius: 8px;
      background: #fff; padding: 2.5rem;
      text-align: center; max-width: 480px; width: 100%;
    }
    h1 { color: #04223e; font-size: 1.5rem; margin-bottom: 0.75rem; }
    p  { color: #04223e; font-size: 1rem; opacity: 0.7; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authenticated!</h1>
    <p>You can close this tab and return to the CLI.</p>
  </div>
  <script>history.replaceState(null, "", location.pathname)</script>
</body>
</html>`;

export const authLoginCommand = defineCommand<{ force: boolean }>({
  command: "login",
  describe: "Authenticate with bunny.net via the browser.",

  builder: (yargs) =>
    yargs.option("force", {
      type: "boolean",
      default: false,
      describe: "Overwrite existing profile without confirmation",
    }),

  handler: async ({ profile, force, verbose }) => {
    if (profileExists(profile)) {
      logger.warn(
        `Profile "${profile}" already exists and will be overwritten.`,
      );
      const ok = await confirm("Continue?", { force });
      if (!ok) {
        logger.log("Login cancelled.");
        process.exit(1);
      }
    }

    const state = randomBytes(16).toString("hex");

    const {
      promise: apiKeyPromise,
      resolve,
      reject,
    } = Promise.withResolvers<string>();

    // The callback URL carries the API key in a query string, so every
    // response here sets Cache-Control: no-store to keep the browser from
    // persisting it to disk cache.
    const NO_STORE = { "Cache-Control": "no-store" };

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/callback") {
          return new Response("Not found", {
            status: 404,
            headers: NO_STORE,
          });
        }
        if (req.method !== "GET") {
          return new Response("Method Not Allowed", {
            status: 405,
            headers: { ...NO_STORE, Allow: "GET" },
          });
        }

        const returnedState = url.searchParams.get("state");
        const apiKey = url.searchParams.get("apiKey");

        if (returnedState !== state) {
          reject(new Error("State mismatch: possible CSRF attack"));
          return new Response("Invalid state parameter.", {
            status: 400,
            headers: NO_STORE,
          });
        }

        if (!apiKey) {
          reject(new Error("No apiKey in callback"));
          return new Response("Missing API key.", {
            status: 400,
            headers: NO_STORE,
          });
        }

        resolve(apiKey);
        return new Response(SUCCESS_HTML, {
          headers: { ...NO_STORE, "Content-Type": "text/html" },
        });
      },
    });

    const callbackUrl = `http://127.0.0.1:${server.port}/callback?state=${state}`;
    const authUrl = `${DASHBOARD_URL}/auth/login?source=cli&domain=localhost&callbackUrl=${encodeURIComponent(callbackUrl)}`;

    logger.info("Opening browser to authenticate...");
    logger.log();
    logger.dim(`If the browser doesn't open, visit:\n  ${authUrl}`);
    logger.log();

    openBrowser(authUrl);
    logger.info("Waiting for authentication...");

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => {
      timeoutId = setTimeout(
        () => rej(new Error("Authentication timed out after 5 minutes")),
        AUTH_TIMEOUT_MS,
      );
    });

    try {
      const apiKey = await Promise.race([apiKeyPromise, timeout]);
      setProfile(profile, apiKey);

      // Fetch user details for a personalised greeting
      const config = resolveConfig(profile);
      const client = createCoreClient(clientOptions(config, verbose));

      const spin = spinner("Verifying credentials...");
      spin.start();
      const { data } = await client.GET("/user");
      spin.stop();

      const name = data
        ? [data.FirstName, data.LastName].filter(Boolean).join(" ")
        : null;

      logger.log();
      logger.success(
        name
          ? `Welcome, ${name}! 🐰`
          : `Authenticated! Profile "${profile}" saved. 🐇`,
      );
      logger.log();
      logger.dim(
        "You can now use the CLI to manage edge scripts, databases, apps, and storage.",
      );
    } catch (err: any) {
      logger.error(`Authentication failed: ${err.message}`);
      process.exit(1);
    } finally {
      clearTimeout(timeoutId);
      server.stop(true);
    }
  },
});
