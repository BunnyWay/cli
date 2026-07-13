export class SandboxError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "SandboxError";
  }
}

/** Thrown when a command exceeds its timeout. Carries the output collected so far. */
export class CommandTimeoutError extends SandboxError {
  constructor(
    readonly timeoutMs: number,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(`Command timed out after ${timeoutMs}ms.`);
    this.name = "CommandTimeoutError";
  }
}
