import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { readBackRecoveryCompactionHarness, seedRecoveryCompactionHarness } from "./recovery-compaction-harness.js";

describe("F-133 reload wiring harness", () => {
  it("reads back two isolated documents and an incomplete append-only tail after restart", async () => {
    const factory = new IDBFactory();
    const databaseName = "recovery-compaction-harness-unit";
    const seed = await seedRecoveryCompactionHarness(factory, databaseName);
    expect(seed).toEqual(expect.objectContaining({
      phase: "seed",
      ok: true,
      alphaOperationCount: 3,
      betaOperationCount: 1,
      compaction: expect.objectContaining({ status: "compacted", revision: 2, readBackVerified: true }),
    }));

    const recovered = await readBackRecoveryCompactionHarness(factory, databaseName);
    expect(recovered).toEqual(expect.objectContaining({
      phase: "recover",
      ok: true,
      alphaRevision: 2,
      betaRevision: 1,
      operationCounts: { alpha: 3, beta: 1 },
      replayIdempotent: true,
      alphaReceipt: expect.objectContaining({
        code: "RECOVERY_DEGRADED",
        source: "compaction",
        ignoredOperationIds: ["alpha-incomplete-browser-tail"],
        uncleanSessionIds: ["browser-crashed"],
      }),
      betaReceipt: expect.objectContaining({
        code: "RECOVERY_REPLAYED",
        source: "operation-log",
        ignoredOperationIds: [],
        uncleanSessionIds: ["browser-crashed"],
      }),
    }));
  });
});
