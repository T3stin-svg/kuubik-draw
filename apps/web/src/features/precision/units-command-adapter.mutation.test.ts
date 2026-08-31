import { createEmptyDocument } from "@kuubik/cad-core";
import type { CadOperation, KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import {
  PrecisionUnitsCommandAdapter,
  PrecisionUnitsPersistenceError,
  type PrecisionUnitsPersistencePort,
} from "./units-command-adapter.js";

describe("F-053 UNITS persistence mutation sentinels", () => {
  it("does not accept the candidate session when durable read-back differs", async () => {
    const source = createEmptyDocument({ documentId: "units-readback-mutation" });
    let stored = structuredClone(source);
    const persistence: PrecisionUnitsPersistencePort = {
      async recoverDocument() { return { document: structuredClone(stored), ignoredOperationIds: [], corruptSnapshotKeys: [], corruptCompactionKeys: [], sessionHistory: null }; },
      async operations() { return []; },
      async commitRevision(document: KDrawDocumentV1, _operation: CadOperation) { stored = structuredClone(document); },
      async loadDocument() {
        const mutated = structuredClone(stored);
        mutated.metadata.title = "mutated after persistence";
        return mutated;
      },
    };
    const adapter = await PrecisionUnitsCommandAdapter.open(persistence, source.documentId, { operationId: () => "units-mismatch" });
    adapter.openDialog();
    adapter.updateDraft({ insertionUnit: "m" });
    await expect(adapter.commit()).rejects.toMatchObject({ code: "READBACK_MISMATCH" } satisfies Partial<PrecisionUnitsPersistenceError>);
    expect(adapter.readBack()).toMatchObject({ document: source, blocked: true, canUndo: false });
    expect(() => adapter.openDialog()).toThrow(/blocked/u);
  });

  it("refuses degraded recovery before opening a mutable session", async () => {
    const source = createEmptyDocument({ documentId: "units-degraded" });
    const persistence: PrecisionUnitsPersistencePort = {
      async recoverDocument() { return { document: source, ignoredOperationIds: ["bad-op"], corruptSnapshotKeys: [], corruptCompactionKeys: [], sessionHistory: null }; },
      async operations() { throw new Error("must not load operations"); },
      async loadDocument() { return source; },
      async commitRevision() { throw new Error("must not commit"); },
    };
    await expect(PrecisionUnitsCommandAdapter.open(persistence, source.documentId))
      .rejects.toMatchObject({ code: "RECOVERY_INVALID" } satisfies Partial<PrecisionUnitsPersistenceError>);
  });
});
