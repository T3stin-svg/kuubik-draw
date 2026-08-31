import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(name: string): Promise<string> {
  return readFile(new URL(name, import.meta.url), "utf8");
}

describe("F-098 paper workspace wiring ratchets", () => {
  it("requires explicit migration and validates paper state before session exposure", async () => {
    const orchestrator = await source("./document-live-orchestrator.ts");
    expect(orchestrator).toContain('paperWorkspace?: "migrate"');
    const migration = orchestrator.slice(orchestrator.indexOf('if (input.paperWorkspace === "migrate")'), orchestrator.indexOf("if (!recovery.document)"));
    expect(migration).toContain("migratePaperWorkspace(document)");
    expect(migration.indexOf("await this.#autosave.commit(")).toBeLessThan(migration.indexOf("readPaperWorkspace(document)"));
    expect(orchestrator.indexOf("readPaperWorkspace(document)")).toBeLessThan(orchestrator.indexOf("this.#coordinator.open(document"));
  });

  it("persists paper plans before synchronizing live Model/Paper context", async () => {
    const workspace = await source("./document-paper-workspace.ts");
    const commit = workspace.slice(workspace.indexOf("private async commit("), workspace.indexOf("private synchronizeActiveLayout("));
    expect(commit).toContain("await this.live.commit(");
    expect(commit.indexOf("await this.live.commit(")).toBeLessThan(commit.indexOf("this.synchronizeActiveLayout()"));
    expect(workspace).not.toContain("App.tsx");
    expect(workspace).not.toContain("DocumentLayoutPlotShell");
  });
});
