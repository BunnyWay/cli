// Anything outside this set changes meaning once the value is pasted into a shell.
const SHELL_SAFE = /^[\w@%+=:,./-]+$/;

/** Single-quote a value so it survives being pasted into a shell. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** As {@link shellQuote}, but leaves a value that needs no quoting alone. */
export function shellQuoteIfNeeded(value: string): string {
  return value !== "" && SHELL_SAFE.test(value) ? value : shellQuote(value);
}
