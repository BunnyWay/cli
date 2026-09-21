import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import blogSql from "@templates/databases/blog-0.sql" with { type: "text" };
import coursePlatformSql from "@templates/databases/course-platform-0.sql" with {
  type: "text",
};
import ecommerceSql from "@templates/databases/ecommerce-0.sql" with {
  type: "text",
};
import eventTicketingSql from "@templates/databases/event-ticketing-0.sql" with {
  type: "text",
};
import helpdeskSql from "@templates/databases/helpdesk-0.sql" with {
  type: "text",
};
import templateIndexJson from "@templates/databases/index.jsonc" with {
  type: "text",
};
import invoicingSql from "@templates/databases/invoicing-0.sql" with {
  type: "text",
};
import linkShortenerSql from "@templates/databases/link-shortener-0.sql" with {
  type: "text",
};
import saasStarterSql from "@templates/databases/saas-starter-0.sql" with {
  type: "text",
};
import videoPlatformSql from "@templates/databases/video-platform-0.sql" with {
  type: "text",
};
import { UserError } from "@/core/errors.ts";
import { checksum, slugify } from "./migrations/engine.ts";

/** Entry shape in templates/databases/index.jsonc, shared with the dashboard. */
interface TemplateIndexEntry {
  id: string;
  name: string;
  description: string;
  tables: string[];
  views?: string[];
}

export interface DatabaseTemplate extends TemplateIndexEntry {
  /** Filename slug for the migration this template writes, e.g. `course_platform`. */
  slug: string;
  sql: string;
}

/** Value of `--template` that asks for an empty database without prompting. */
export const TEMPLATE_NONE = "none";

const SQL_BY_ID: Record<string, string> = {
  "blog-0": blogSql,
  "course-platform-0": coursePlatformSql,
  "ecommerce-0": ecommerceSql,
  "event-ticketing-0": eventTicketingSql,
  "helpdesk-0": helpdeskSql,
  "invoicing-0": invoicingSql,
  "link-shortener-0": linkShortenerSql,
  "saas-starter-0": saasStarterSql,
  "video-platform-0": videoPlatformSql,
};

/** Template ids carry a version suffix the dashboard needs, so `blog` also names `blog-0`. */
function baseId(id: string): string {
  return id.trim().toLowerCase().replace(/-\d+$/, "");
}

function buildCatalog(): DatabaseTemplate[] {
  const entries = JSON.parse(templateIndexJson) as TemplateIndexEntry[];
  const catalog: DatabaseTemplate[] = [];

  for (const entry of entries) {
    const sql = SQL_BY_ID[entry.id];
    if (!sql) continue;
    catalog.push({ ...entry, slug: slugify(baseId(entry.id)), sql });
  }

  return catalog;
}

/** Schema templates embedded at bundle time from templates/databases/. */
export const DATABASE_TEMPLATES: DatabaseTemplate[] = buildCatalog();

/** Resolve a `--template` value, accepting either `blog` or the dashboard's `blog-0`. */
export function findTemplate(id: string): DatabaseTemplate | undefined {
  const wanted = baseId(id);
  return DATABASE_TEMPLATES.find((template) => baseId(template.id) === wanted);
}

/** Resolve a `--template` value or explain what was expected. */
export function requireTemplate(id: string): DatabaseTemplate {
  const template = findTemplate(id);
  if (template) return template;

  throw new UserError(
    `Unknown database template: ${id}`,
    `Available templates: ${DATABASE_TEMPLATES.map((t) => baseId(t.id)).join(", ")}, or ${TEMPLATE_NONE} for an empty database.`,
  );
}

/** Select choices listing an empty database first, then every template. */
export function templateChoices(): {
  title: string;
  description?: string;
  value: string;
}[] {
  return [
    {
      title: "Empty database",
      description: "No tables; add your own migrations later",
      value: TEMPLATE_NONE,
    },
    ...DATABASE_TEMPLATES.map((template) => ({
      title: template.name,
      description: template.description,
      value: template.id,
    })),
  ];
}

/**
 * Refuse to add a template to a project that already has migrations.
 *
 * The template would be written after those files but applied to an empty
 * database, so the history would be out of order from the first run.
 */
export function assertNoExistingMigrations(dir: string): void {
  if (!existsSync(dir)) return;

  const existing = readdirSync(dir).filter((file) => file.endsWith(".sql"));
  if (existing.length === 0) return;

  throw new UserError(
    `${relative(process.cwd(), dir) || dir} already holds ${existing.length} migration${existing.length === 1 ? "" : "s"}.`,
    `Create the database without a template, then run \`bunny db migrations apply\`.`,
  );
}

export interface WrittenMigration {
  /** Filename including the extension, which is the migration's identity. */
  name: string;
  path: string;
  displayPath: string;
  sql: string;
  checksum: string;
}

/** Write a template's SQL as the first migration in `dir`. */
export function writeTemplateMigration(
  template: DatabaseTemplate,
  dir: string,
): WrittenMigration {
  const name = `0001_${template.slug}.sql`;
  const path = join(dir, name);

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, template.sql);

  return {
    name,
    path,
    displayPath: relative(process.cwd(), path) || name,
    sql: template.sql,
    checksum: checksum(template.sql),
  };
}
