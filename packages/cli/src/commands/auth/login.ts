import { randomBytes } from "node:crypto";
import { createCoreClient } from "@bunny.net/openapi-client";
import {
  profileExists,
  resolveConfig,
  setProfile,
} from "../../config/index.ts";
import { clientOptions } from "../../core/client-options.ts";
import { defineCommand } from "../../core/define-command.ts";
import { UserError } from "../../core/errors.ts";
import { detectHeadless } from "../../core/headless.ts";
import { logger } from "../../core/logger.ts";
import {
  confirm,
  isInteractive,
  openBrowser,
  prompts,
  readPassword,
  spinner,
} from "../../core/ui.ts";
import { hintShellCompletion } from "../completion/hint.ts";
import { offerGlobalSkillInstall } from "../skills/offer.ts";

const DASHBOARD_URL =
  process.env.BUNNYNET_DASHBOARD_URL ?? "https://dash.bunny.net";
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

const KEY_HINT = `Create an API key in the bunny.net dashboard under Account Settings > API:\n  ${DASHBOARD_URL}`;

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

/** Loopback browser flow; `tunnel` prints the SSH forward the callback needs to be reachable from another machine. */
async function browserLogin(opts: { tunnel: boolean }): Promise<string> {
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

  if (opts.tunnel) {
    logger.log();
    logger.dim(
      `Forward the callback port from your own machine first:\n  ssh -L ${server.port}:127.0.0.1:${server.port} <user>@<this-host>`,
    );
    logger.log();
    logger.dim(`Then open:\n  ${authUrl}`);
    logger.log();
  } else {
    logger.info("Opening browser to authenticate...");
    logger.log();
    logger.dim(`If the browser doesn't open, visit:\n  ${authUrl}`);
    logger.log();
    openBrowser(authUrl);
  }

  logger.info("Waiting for authentication...");

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timeoutId = setTimeout(
      () => rej(new Error("Authentication timed out after 5 minutes")),
      AUTH_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([apiKeyPromise, timeout]);
  } catch (err: any) {
    throw new UserError(`Authentication failed: ${err.message}`);
  } finally {
    clearTimeout(timeoutId);
    // Graceful stop: the success page is still flushing to the browser.
    server.stop();
    setTimeout(() => server.stop(true), 1000).unref?.();
  }
}

/** Masked prompt for an API key pasted from the dashboard. */
async function pasteApiKey(): Promise<string> {
  logger.log();
  logger.dim(KEY_HINT);
  logger.log();

  const key = (await readPassword("API key:")).trim();
  if (!key) throw new UserError("No API key entered.");
  return key;
}

/** Ask how to authenticate when no usable browser is available. */
async function promptHeadlessMethod(): Promise<"paste" | "browser"> {
  const { method } = await prompts({
    type: "select",
    name: "method",
    message: "How would you like to authenticate?",
    choices: [
      {
        title: "Paste an API key",
        value: "paste",
        description: "Create one in the dashboard and paste it here",
      },
      {
        title: "Print the login URL instead",
        value: "browser",
        description: "Needs an SSH port forward to reach this machine",
      },
    ],
  });

  if (!method) throw new UserError("Login cancelled.");
  return method;
}

/** Obtain an API key by whichever route this environment can actually support. */
async function acquireApiKey(output: string): Promise<string> {
  const headless = detectHeadless();
  if (!headless) return browserLogin({ tunnel: false });

  logger.warn(headless.message);

  if (!isInteractive(output)) {
    throw new UserError(
      "Cannot open a browser to log in, and there is no terminal to prompt on.",
      `Pass --api-key <key> or set BUNNYNET_API_KEY instead.\n${KEY_HINT}`,
    );
  }

  const method = await promptHeadlessMethod();
  return method === "paste" ? pasteApiKey() : browserLogin({ tunnel: true });
}

/** Check a key against `/user` and return the account holder's name; a 401 is fatal so a mistyped key never lands in the config. */
async function verifyApiKey(
  apiKey: string,
  verbose: boolean,
): Promise<string | null> {
  const config = resolveConfig("", apiKey, verbose);
  const client = createCoreClient(clientOptions(config, verbose));

  const spin = spinner("Verifying credentials...");
  spin.start();
  try {
    const { data } = await client.GET("/user");
    return data
      ? [data.FirstName, data.LastName].filter(Boolean).join(" ")
      : null;
  } catch (err: any) {
    if (err?.status === 401) {
      throw new UserError("That API key was rejected by bunny.net.", KEY_HINT);
    }
    logger.debug(`Could not verify the API key: ${err?.message}`, verbose);
    return null;
  } finally {
    spin.stop();
  }
}

export const authLoginCommand = defineCommand<{
  force: boolean;
  installSkill?: boolean;
}>({
  command: "login",
  describe: "Authenticate with bunny.net via the browser.",

  examples: [
    ["$0 login", "Log in through the browser"],
    [
      "$0 login --api-key $BUNNYNET_API_KEY",
      "Log in without a browser, for remote or headless machines",
    ],
  ],

  builder: (yargs) =>
    yargs
      .option("force", {
        type: "boolean",
        default: false,
        describe: "Overwrite existing profile without confirmation",
      })
      .option("install-skill", {
        type: "boolean",
        describe:
          "Install the agent skill after login without prompting (--no-install-skill skips the offer)",
      }),

  handler: async ({
    profile,
    force,
    verbose,
    output,
    installSkill,
    apiKey: apiKeyFlag,
  }) => {
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

    const apiKey = apiKeyFlag?.trim() || (await acquireApiKey(output));
    const name = await verifyApiKey(apiKey, verbose);

    setProfile(profile, apiKey);

    if (output === "json") {
      logger.log(
        JSON.stringify({ authenticated: true, profile, name }, null, 2),
      );
    } else {
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
    }

    await offerGlobalSkillInstall(output, installSkill);
    hintShellCompletion(output);
  },
});
