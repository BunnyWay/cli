import {
  applyEdits,
  type FormattingOptions,
  modify,
  parse as parseJsonc,
} from "jsonc-parser";

const FORMATTING: FormattingOptions = { tabSize: 2, insertSpaces: true };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function equalLeaf(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Reconcile the value at `path` to `desired`, recursing into objects so comments and formatting on unchanged keys survive.
function reconcile(
  text: string,
  path: (string | number)[],
  existing: unknown,
  desired: unknown,
): string {
  if (isPlainObject(desired) && isPlainObject(existing)) {
    let out = text;
    for (const [key, value] of Object.entries(desired)) {
      out = reconcile(out, [...path, key], existing[key], value);
    }
    for (const key of Object.keys(existing)) {
      if (!(key in desired)) {
        out = applyEdits(
          out,
          modify(out, [...path, key], undefined, {
            formattingOptions: FORMATTING,
          }),
        );
      }
    }
    return out;
  }

  if (equalLeaf(existing, desired)) return text;
  return applyEdits(
    text,
    modify(text, path, desired, { formattingOptions: FORMATTING }),
  );
}

// Edit JSONC `text` to match `desired`, preserving comments and formatting on unchanged keys; fresh-serializes when `text` isn't a JSON object.
export function syncJsonc(
  text: string,
  desired: Record<string, unknown>,
): string {
  const existing = parseJsonc(text);
  if (!isPlainObject(existing)) {
    return `${JSON.stringify(desired, null, 2)}\n`;
  }
  const merged = reconcile(text, [], existing, desired);
  return merged.endsWith("\n") ? merged : `${merged}\n`;
}
