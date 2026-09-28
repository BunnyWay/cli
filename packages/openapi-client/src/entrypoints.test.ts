import { describe, expect, test } from "bun:test";
import { createComputeClient } from "./compute.ts";
import type { components } from "./core.ts";
import { createCoreClient, DnsRecordScanStatus } from "./core.ts";
import { createDbClient } from "./database.ts";
import * as root from "./index.ts";
import { createMcClient } from "./magic-containers.ts";
import { createOriginErrorsClient } from "./origin-errors.ts";
import { createShieldClient } from "./shield.ts";
import { createStorageClient } from "./storage.ts";
import { createStreamClient } from "./stream.ts";

describe("root entrypoint", () => {
  test("exports authMiddleware for composing custom clients", () => {
    expect(typeof root.authMiddleware).toBe("function");
    const middleware = root.authMiddleware({ apiKey: "k" });
    expect(typeof middleware.onRequest).toBe("function");
    expect(typeof middleware.onResponse).toBe("function");
  });
});

describe("per-API entrypoints", () => {
  test("re-export the same factories as the root entrypoint", () => {
    expect(createCoreClient).toBe(root.createCoreClient);
    expect(createComputeClient).toBe(root.createComputeClient);
    expect(createDbClient).toBe(root.createDbClient);
    expect(createMcClient).toBe(root.createMcClient);
    expect(createOriginErrorsClient).toBe(root.createOriginErrorsClient);
    expect(createShieldClient).toBe(root.createShieldClient);
    expect(createStorageClient).toBe(root.createStorageClient);
    expect(createStreamClient).toBe(root.createStreamClient);
  });

  test("core entrypoint carries the DNS scan corrections", () => {
    expect(DnsRecordScanStatus.Completed).toBe(
      root.DnsRecordScanStatus.Completed,
    );
  });

  test("generated spec types are importable from the entrypoint", () => {
    // Compile-time assertion: `components` resolves from ./core.ts.
    const zone: Pick<components["schemas"]["DnsZoneModel"], "Domain"> = {
      Domain: "example.com",
    };
    expect(zone.Domain).toBe("example.com");
  });
});
