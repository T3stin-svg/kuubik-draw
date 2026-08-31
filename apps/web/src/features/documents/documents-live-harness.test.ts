import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { runDocumentsLiveHarness } from "./documents-live-harness.js";

describe("F-115/F-128/F-133 deterministic browser wiring harness", () => {
  it("proves atomic underlay persistence, crash/reload recovery and invalid revision rejection", async () => {
    const result = await runDocumentsLiveHarness(new IDBFactory());
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      atomicPdfReadback: expect.objectContaining({
        documentRevision: 1,
        operationCount: 1,
        snapshotRevisions: [0, 1],
        byteLength: expect.any(Number),
      }),
      recovery: {
        alphaRevision: 1,
        betaRevision: 1,
        ignoredOperationIds: ["beta-line-2"],
        uncleanSessionIds: ["browser-session-crashed"],
      },
      rejected: { staleRevision: true, corruptTail: true },
    }));
    expect(result.beforeCrash.tabs).toEqual(expect.objectContaining({
      activeDocumentId: "beta",
      tabOrder: ["alpha", "beta"],
      tabs: [
        expect.objectContaining({ documentId: "alpha", revision: 1, persistedRevision: 1, dirty: false }),
        expect.objectContaining({ documentId: "beta", revision: 2, persistedRevision: 2, dirty: false }),
      ],
    }));
    expect(result.afterReload.tabs).toEqual(expect.objectContaining({
      activeDocumentId: "beta",
      tabOrder: ["alpha", "beta"],
      tabs: [
        expect.objectContaining({ documentId: "alpha", revision: 1 }),
        expect.objectContaining({ documentId: "beta", revision: 1 }),
      ],
    }));
  });
});
