import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(name: string): Promise<string> {
  return readFile(new URL(name, import.meta.url), "utf8");
}

describe("F-096/F-097 document-model wiring ratchets", () => {
  it("keeps legacy migration explicit and validates persisted workspace before session exposure", async () => {
    const orchestrator = await source("./document-live-orchestrator.ts");
    expect(orchestrator).toContain('layoutWorkspace?: "migrate"');
    const migration = orchestrator.slice(
      orchestrator.indexOf('if (input.layoutWorkspace === "migrate" || input.paperWorkspace === "migrate")'),
      orchestrator.indexOf("if (!recovery.document)"),
    );
    expect(migration).toContain("migrateLayoutWorkspace(document)");
    expect(migration.indexOf("await this.#autosave.commit(")).toBeLessThan(migration.indexOf("readLayoutWorkspace(document)"));
    expect(orchestrator.indexOf("readLayoutWorkspace(document)")).toBeLessThan(orchestrator.indexOf("this.#coordinator.open(document"));
  });

  it("persists each atomic layout plan before changing live active-layout state", async () => {
    const workspace = await source("./document-layout-workspace.ts");
    const commit = workspace.slice(workspace.indexOf("private async commit("), workspace.indexOf("private synchronizeActiveLayout("));
    expect(commit).toContain("await this.live.commit(");
    expect(commit.indexOf("await this.live.commit(")).toBeLessThan(commit.indexOf("this.synchronizeActiveLayout()"));
    expect(workspace).not.toContain("App.tsx");
    expect(workspace).not.toContain("DocumentLayoutPlotShell");
  });
});
