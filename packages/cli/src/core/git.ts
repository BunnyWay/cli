/** Run `git` in `cwd`, returning trimmed stdout, or null when git fails, times out, or isn't installed. */
export async function runGit(
  cwd: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      timeout: opts.timeoutMs,
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    const [code, out] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
    ]);
    return code === 0 ? out.trim() : null;
  } catch {
    return null;
  }
}
