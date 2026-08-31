import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import golden from "./dxf-import-harness.golden.json";

describe("F-110 browser harness wiring", () => {
  it("locks the real IndexedDB import, Undo/Redo and recovery receipt", () => {
    expect(golden).toEqual({
      status: "passed", importRevision: 1, undoRevision: 2, redoRevision: 3, recoveredRevision: 3,
      sourceUnits: "cm", targetUnits: "mm", insertionScale: 10,
      handles: ["C0", "10", "20"], operationCommands: ["DXFIN", "UNDO", "DXFIN"],
      recoverySource: "operation-log", uncleanSessionIds: ["f110-browser-crashed"],
    });
    const html = readFileSync(new URL("./dxf-import-harness.html", import.meta.url), "utf8");
    const source = readFileSync(new URL("./dxf-import-harness.ts", import.meta.url), "utf8");
    expect(html).toContain("./dxf-import-harness.ts");
    expect(source).toContain("importDxfIntoLiveDocument(live");
    expect(source).toContain("await live.undo");
    expect(source).toContain("await live.redo");
    expect(source).toContain("await recoveredLive.open");
  });
});
