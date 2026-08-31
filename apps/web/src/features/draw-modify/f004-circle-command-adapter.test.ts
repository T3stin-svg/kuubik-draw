import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { CadSession } from "../../../../../packages/cad-core/src/transaction.js";
import { createAtomicCommandWorkflow } from "./atomic-command-workflow.js";
import { circleCommandAdapter } from "./circle-command-adapter.js";

describe("F-004 CIRCLE feature wiring", () => {
  it("uses identical TTR preparation for preview and one atomic Commit/Undo/Redo", () => {
    const document = createEmptyDocument({ documentId: "F-004-adapter", now: "2026-09-01T09:00:00.000Z" });
    document.layers.push({ id: "GEOM", name: "GEOM", visible: true, frozen: false, locked: false, plottable: true });
    const workflow = createAtomicCommandWorkflow(new CadSession(document), circleCommandAdapter);
    const input = {
      command: "CIRCLE" as const,
      handle: "C4",
      layerId: "GEOM",
      construction: {
        mode: "ttr" as const,
        first: { kind: "line" as const, start: { x: 0, y: -100 }, end: { x: 0, y: 100 }, pickPoint: { x: 0, y: 5 } },
        second: { kind: "line" as const, start: { x: -100, y: 0 }, end: { x: 100, y: 0 }, pickPoint: { x: 5, y: 0 } },
        radius: 5,
      },
      appearance: { color: "#336699", colorMethod: "trueColor" as const, lineweightMm: 0.35 },
      extensionData: { rowId: "F-004" },
    };
    const preview = workflow.preview(input);
    const previewEntity = preview.changes[0]?.type === "put" ? preview.changes[0].entity : null;
    expect(previewEntity).toMatchObject({ kind: "circle", handle: "C4", layerId: "GEOM", center: { x: 5, y: 5 }, radius: 5 });
    workflow.commit(input, "F-004:adapter:1", "2026-09-01T09:00:01.000Z");
    expect(workflow.session.document.entities).toEqual([previewEntity]);
    workflow.undo("2026-09-01T09:00:02.000Z");
    expect(workflow.session.document.entities).toEqual([]);
    workflow.redo("2026-09-01T09:00:03.000Z");
    expect(workflow.session.document.entities).toEqual([previewEntity]);
  });
});
