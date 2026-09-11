/**
 * Output scrubbing and credential redaction. These are a security boundary, so
 * the behaviour is covered by tests.
 */

const ANSI_PATTERN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal escapes is the point
  /[\u001B\u009B][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007|(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~])/g;

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the point
const CONTROL_PATTERN = /[\u0000-\u001F\u007F-\u009F]/g;

/** Remove ANSI escape sequences, so a hostile video title cannot paint the terminal. */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "");
}

/** Strip escapes and control characters, then truncate. */
export function sanitizeString(input: string, maxLength = 500): string {
  const cleaned = stripAnsi(input).replace(CONTROL_PATTERN, "");

  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

const MAX_DESCRIPTION = 10_000;
const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 100;

export function sanitizeMetadata(meta: {
  description?: string;
  tags?: string[];
}): { description?: string; tags?: string[] } {
  const out: { description?: string; tags?: string[] } = {};
  if (meta.description) {
    out.description = sanitizeString(meta.description, MAX_DESCRIPTION);
  }
  if (meta.tags?.length) {
    out.tags = meta.tags
      .slice(0, MAX_TAGS)
      .map((t) => sanitizeString(t, MAX_TAG_LENGTH))
      .filter((t) => t.length > 0);
  }

  return out;
}

const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/api[_-]?key=[^\s&]+/gi, "api_key=[REDACTED]"],
  [/access[_-]?key[_-]?id=[^\s&]+/gi, "access_key_id=[REDACTED]"],
  [/secret[_-]?access[_-]?key=[^\s&]+/gi, "secret_access_key=[REDACTED]"],
  [/access[_-]?token=[^\s&]+/gi, "access_token=[REDACTED]"],
  [/session[_-]?token=[^\s&]+/gi, "session_token=[REDACTED]"],
  [/bearer\s+[\w.-]+/gi, "bearer [REDACTED]"],
  [/authorization=[^\s&]+/gi, "authorization=[REDACTED]"],
  [/password=[^\s&]+/gi, "password=[REDACTED]"],
  [/secret=[^\s&]+/gi, "secret=[REDACTED]"],
  [/AKIA[0-9A-Z]{16}/g, "[REDACTED]"],
];

/**
 * Turn an unknown thrown value into a message safe to print: credentials
 * redacted, and anything that looks like a stack trace collapsed to a generic
 * line so internal paths never leak.
 */
export function safeErrorMessage(error: unknown, context: string): string {
  let message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  if (!message) return `${context}: An internal error occurred`;

  if (message.includes("at ") || message.includes("/node_modules/")) {
    return `${context}: An internal error occurred`;
  }

  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    message = message.replace(pattern, replacement);
  }

  return sanitizeString(message, 500);
}

/** The default `SourceAdapter.validateUrl`: HTTPS only. */
export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Bunny GUIDs and collection IDs, validated before going into a path. */
export function isValidBunnyGuid(guid: string): boolean {
  return /^[a-zA-Z0-9-]{1,64}$/.test(guid);
}
