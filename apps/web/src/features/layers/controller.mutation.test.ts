import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../../../../../packages/cad-core/src/document.js";
import { LayerManagerController } from "./controller.js";

describe("Layer Manager mutation guards", () => {
  it("kills multi-revision, stale-plan and partial-rollback mutations", () => {
    const source = createEmptyDocument({ documentId: "layer-mutation", now: "2026-08-31T00:00:00Z" });
    const controller = new LayerManagerController(source, { opIdPrefix: "mutation", now: () => "2026-08-31T00:01:00Z" });
    const committed = controller.execute({ type: "create", name: "A", requestedId: "A" });
    expect(committed.committed).toMatchObject({ committedRevision: 1, operation: { opId: "mutation:0:1:LAYER_CREATE", baseRevision: 0 } });
    const before = controller.document;
    expect(() => controller.execute({ type: "toggle", layerId: "missing", property: "locked", value: true })).toThrow("does not exist");
    expect(controller.document).toEqual(before);
    expect(source.layers.map((layer) => layer.id)).toEqual(["0"]);
  });
});
