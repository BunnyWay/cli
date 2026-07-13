export class SandboxError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "SandboxError";
  }
}

export class HostKeyVerificationError extends SandboxError {
  override name = "HostKeyVerificationError";
}
