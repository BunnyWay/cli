import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ProjectType = "node" | "bun" | "go";

export interface DetectedProject {
  type: ProjectType;
  label: string;
}

/**
 * Detect a project type from files in the given directory.
 * Bun is checked before Node because bun projects also have a package.json.
 */
export function detectProject(cwd: string): DetectedProject | null {
  if (existsSync(join(cwd, "bun.lock")) || existsSync(join(cwd, "bun.lockb"))) {
    return { type: "bun", label: "Bun" };
  }
  if (existsSync(join(cwd, "package.json"))) {
    return { type: "node", label: "Node.js" };
  }
  if (existsSync(join(cwd, "go.mod"))) {
    return { type: "go", label: "Go" };
  }
  return null;
}

const NODE_DOCKERFILE = `ARG NODE_VERSION=20
FROM node:\${NODE_VERSION}-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
`;

const BUN_DOCKERFILE = `FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock* bun.lockb* ./
RUN bun install --frozen-lockfile --production

COPY . .

ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "start"]
`;

const GO_DOCKERFILE = `ARG GO_VERSION=1
FROM golang:\${GO_VERSION}-bookworm AS builder

WORKDIR /usr/src/app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN go build -v -o /app .

FROM debian:bookworm-slim
COPY --from=builder /app /usr/local/bin/app
CMD ["app"]
`;

const TEMPLATES: Record<ProjectType, string> = {
  node: NODE_DOCKERFILE,
  bun: BUN_DOCKERFILE,
  go: GO_DOCKERFILE,
};

/** Write a Dockerfile for the given project type to `cwd/Dockerfile`. */
export function writeDockerfile(cwd: string, type: ProjectType): string {
  const path = join(cwd, "Dockerfile");
  writeFileSync(path, TEMPLATES[type]);
  return path;
}
