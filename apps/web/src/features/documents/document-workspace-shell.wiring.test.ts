import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
}

describe("F-128/F-129/F-130 wiring ratchets", () => {
  it("persists SHA-bound history before accepting candidate session state", () => {
    const coordinator = source("./document-session-coordinator.ts");
    const indexedDb = source("../../indexed-db.ts");
    const persisted = coordinator.slice(coordinator.indexOf("async commitPersisted("), coordinator.indexOf("async undoPersisted("));
    expect(persisted.indexOf("await persist(candidate.document, operation, candidate.history)")).toBeLessThan(persisted.indexOf("this.acceptCandidate(entry, candidate)"));
    expect(indexedDb).toContain("sessionHistorySha256");
    expect(indexedDb).toContain("&& await validSessionHistory(record)");
    expect(indexedDb).toContain('source === "operation-log" || source === "compaction" ? replayedSessionHistory : null');
  });

  it("keeps command history on the document entry and applies explicit alias precedence", () => {
    const coordinator = source("./document-session-coordinator.ts");
    const shell = source("./document-workspace-shell.ts");
    expect(coordinator).toContain("commandHistory: string[]");
    expect(coordinator).toContain("this.requireEntry(documentId).commandHistory.push");
    expect(shell.indexOf("if (this.#canonical.has(normalized))")).toBeLessThan(shell.indexOf("const imported = this.#imported.get(normalized)"));
    expect(shell.indexOf("const imported = this.#imported.get(normalized)")).toBeLessThan(shell.indexOf("const builtIn = this.#builtIn.get(normalized)"));
    expect(shell).toContain('resolution: "incoming-wins"');
  });
});
