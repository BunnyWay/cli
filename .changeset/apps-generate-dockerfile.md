---
"@bunny.net/cli": minor
---

`bunny apps deploy` and `bunny apps init` offer to generate a Dockerfile when a project has none, detecting Node, Bun, Deno, Python, Go, Rust, Ruby, PHP, .NET and Spring Boot apps, down to a single `index.php`, `main.go`, `main.py` or `index.ts`. Agents can deploy without prompts: `--dockerfile` generates the file when it's missing, the new `--region` flag picks the region, and every other question takes its default
