import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { CadSession } from "../../../../../packages/cad-core/src/transaction.js";
import { createAtomicCommandWorkflow } from "./atomic-command-workflow.js";
import { revcloudCommandAdapter } from "./revcloud-command-adapter.js";

describe("F-011 REVCLOUD feature adapter", () => {
  it("uses one deterministic preparation contract for preview, commit and atomic Undo/Redo", () => {
    const document = createEmptyDocument({ documentId: "F-011-adapter", now: "2026-08-31T21:20:00.000Z" });
    document.layers.push({ id: "REV", name: "REV", visible: true, frozen: false, locked: false, plottable: true });
    document.entities.push({ kind: "circle", handle: "C1", layerId: "REV", center: { x: 0, y: 0 }, radius: 25, appearance: { color: "#00aaff" } });
    const workflow = createAtomicCommandWorkflow(new CadSession(document), revcloudCommandAdapter);
    const input = {
      command: "REVCLOUD" as const,
      construction: { mode: "object" as const, sourceHandle: "C1" },
      arcLengths: { minimum: 5, maximum: 10 },
      direction: "normal" as const,
    };
    const preview = workflow.preview(input);
    expect(preview).toMatchObject({ commandId: "REVCLOUD", targetHandles: ["C1"], resultHandles: ["C1"] });
    const previewChange = preview.changes[0];
    if (previewChange?.type !== "put") throw new Error("Expected one prepared REVCLOUD put change.");
    workflow.commit(input, "F-011:adapter:1", "2026-08-31T21:20:01.000Z");
    expect(workflow.session.document.entities).toEqual([previewChange.entity]);
    expect(workflow.session.document.entities[0]).toMatchObject({ kind: "polyline", handle: "C1", layerId: "REV", appearance: { color: "#00aaff" } });
    workflow.undo("2026-08-31T21:20:02.000Z");
    expect(workflow.session.document.entities).toEqual([{ kind: "circle", handle: "C1", layerId: "REV", center: { x: 0, y: 0 }, radius: 25, appearance: { color: "#00aaff" } }]);
    workflow.redo("2026-08-31T21:20:03.000Z");
    expect(workflow.session.document.entities).toEqual([previewChange.entity]);
  });
});
