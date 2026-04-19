import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function getConfigCandidates(): string[] {
  const home = homedir();
  const paths: string[] = [];

  if (process.env.XDG_CONFIG_HOME) {
    paths.push(join(process.env.XDG_CONFIG_HOME, "bunnynet.json"));
  }

  paths.push(
    join(home, ".config", "bunnynet.json"),
    join(home, ".bunnynet.json"),
    "/etc/bunnynet.json",
  );

  return paths;
}

export function findConfigFile(): string | null {
  for (const p of getConfigCandidates()) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function getConfigWritePath(): string {
  const [first = join(homedir(), ".bunnynet.json")] = getConfigCandidates();
  return findConfigFile() ?? first;
}
