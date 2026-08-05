/** Run `git` in `cwd`, returning trimmed stdout, or null when git fails or isn't installed. */
export async function runGit(
  cwd: string,
  args: string[],
): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
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
