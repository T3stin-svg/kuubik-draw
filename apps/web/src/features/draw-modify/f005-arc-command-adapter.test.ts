import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { CadSession } from "../../../../../packages/cad-core/src/transaction.js";
import { arcCommandAdapter } from "./arc-command-adapter.js";
import { createAtomicCommandWorkflow } from "./atomic-command-workflow.js";

describe("F-005 ARC feature wiring", () => {
  it("uses identical Start-End-Direction preparation for preview and atomic Commit/Undo/Redo", () => {
    const document = createEmptyDocument({ documentId: "F-005-adapter", now: "2026-09-01T10:00:00.000Z" });
    document.layers.push({ id: "GEOM", name: "GEOM", visible: true, frozen: false, locked: false, plottable: true });
    const workflow = createAtomicCommandWorkflow(new CadSession(document), arcCommandAdapter);
    const input = {
      command: "ARC" as const,
      handle: "A5",
      layerId: "GEOM",
      construction: {
        mode: "start-end-direction" as const,
        start: { x: 0, y: 0 },
        end: { x: 20, y: 20 },
        tangentDirectionRad: 0,
      },
      appearance: { color: "#336699", colorMethod: "trueColor" as const, lineweightMm: 0.35 },
      extensionData: { rowId: "F-005" },
    };
    const preview = workflow.preview(input);
    const previewEntity = preview.changes[0]?.type === "put" ? preview.changes[0].entity : null;
    expect(previewEntity).toMatchObject({ kind: "arc", handle: "A5", layerId: "GEOM", center: { x: 0, y: 20 }, radius: 20 });
    workflow.commit(input, "F-005:adapter:1", "2026-09-01T10:00:01.000Z");
    expect(workflow.session.document.entities).toEqual([previewEntity]);
    workflow.undo("2026-09-01T10:00:02.000Z");
    expect(workflow.session.document.entities).toEqual([]);
    workflow.redo("2026-09-01T10:00:03.000Z");
    expect(workflow.session.document.entities).toEqual([previewEntity]);
  });
});
