# Set up bunny.net

bunny.net is a global edge platform: CDN, DNS, Edge Storage, Edge Scripts, static sites, Bunny Database, Stream video, and cloud sandboxes. You manage all of it through the `bunny` CLI. Install the CLI, sign the user in, install the bunny.net agent skill, then check that it works.

You need a shell to do this. If you can't run commands (for example in a chat app), tell the user to run the setup from a coding agent or terminal instead, and stop.

Skip any step that's already done. Start by checking:

```bash
bunny --version
bunny whoami
```

## 1. Install the CLI

If `bunny --version` fails, install it with the method that suits the machine:

```bash
curl -fsSL https://cli.bunny.net/install.sh | sh
```

Or, if Node.js is available:

```bash
npm install -g @bunny.net/cli
```

Then run `bunny --version` to confirm it's on the `PATH`. If the shell can't find it, tell the user to open a new terminal or add the install directory to their `PATH`.

## 2. Sign in

If `bunny whoami` already shows an account, skip this step.

Otherwise run:

```bash
bunny login
```

This opens the bunny.net dashboard in the user's browser. Ask them to approve the sign-in there. The CLI stores the key in a local profile.

If you're on a remote or headless machine (SSH, a container, a sandbox, CI), or the browser sign-in fails, use an API key instead. Ask the user to create one in the dashboard under **Account Settings > API** (https://dash.bunny.net), then have them set it as `BUNNYNET_API_KEY` and run:

```bash
bunny login --api-key "$BUNNYNET_API_KEY"
```

Rules for the API key:

- It grants full access to the user's bunny.net account. Treat it as a password.
- Never write it to a file that could be committed, never paste it into code, and never repeat it back in chat.
- Prefer the user setting the environment variable themselves over you handling the value.

## 3. Install the agent skill

The skill teaches you every `bunny` command, with references for each product.

If you're working inside a project, install it there (it adds a block to `AGENTS.md` and writes the skill under `.agents/skills/`):

```bash
bunny skills install
```

If there's no project, or the user wants it everywhere, install it globally:

```bash
bunny skills install --global
```

Some agents only load new skills after a restart. If yours does, tell the user.

## 4. Check it works

```bash
bunny whoami
```

Tell the user which account and profile you're connected to.

Then suggest a first step. If the user named a product when they sent you here, read that product's reference in the skill and start there:

- **Bunny Database**: `bunny db list`, or offer to create one with `bunny db create`.
- **Static sites**: offer to deploy the current project with `bunny sites deploy`.
- **Edge Scripts**: `bunny scripts list`, or offer to start one with `bunny scripts init`.
- **Edge Storage**: `bunny storage zones list`.
- **DNS**: `bunny dns zone list`.
- **Stream**: `bunny stream library list`. To move videos in from another platform, use `bunny stream import`.
- **Sandboxes**: `bunny sandbox list`.

If they didn't name a product, ask what they want to build.

## Rules

- Confirm with the user before anything that deletes data, changes DNS records, or creates resources that cost money.
- Use `--output json` when you need to read a command's result.
- Run `bunny <command> --help` when you're unsure of a flag. Don't guess.
- If a command fails with an auth error, run `bunny whoami` before trying anything else.
