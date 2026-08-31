import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(name: string): Promise<string> {
  return readFile(new URL(name, import.meta.url), "utf8");
}

describe("layout/plot shell caller wiring ratchet", () => {
  it("pins every required core primitive to the DOM-independent shell caller", async () => {
    const text = await source("./layout-plot-shell.ts");
    for (const call of [
      "createPaperLayout(", "renamePaperLayout(", "deletePaperLayout(", "createPaperViewport(",
      "setPaperViewportView(", "panPaperViewportByPixels(", "setPaperViewportDisplayLocked(",
      "setPaperLayoutPageSetup(", "setModelLayoutPageSetup(", "exportLayoutVectorPdf(",
      "exportModelVectorPdf(", "exportLayoutsVectorPdf(", "this.live.commit(", "this.live.readPdf(",
    ]) expect(text, `missing caller ${call}`).toContain(call);
  });

  it("persists undo/redo candidates before accepting them into the live session", async () => {
    const coordinator = await source("./document-session-coordinator.ts");
    const orchestrator = await source("./document-live-orchestrator.ts");
    const undoStart = coordinator.indexOf("async undoPersisted(");
    const undoEnd = coordinator.indexOf("async redoPersisted(");
    const undo = coordinator.slice(undoStart, undoEnd);
    expect(undoStart).toBeGreaterThan(-1);
    expect(undo.indexOf("await persist(candidate.document, committed.operation)")).toBeLessThan(undo.indexOf("this.acceptCandidate(entry, candidate)"));
    expect(orchestrator).toContain("this.#coordinator.undoPersisted(");
    expect(orchestrator).toContain("this.#coordinator.redoPersisted(");
  });
});
