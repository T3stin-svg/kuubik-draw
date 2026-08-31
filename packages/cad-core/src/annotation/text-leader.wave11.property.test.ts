import type { KDrawDocumentV1 } from "@kuubik/cad-schema";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../document.js";
import { createMText, deriveMTextLayout, editMText } from "./text.js";
import { readMTextContract } from "./contracts.js";

function fixture(): KDrawDocumentV1 {
  const document = createEmptyDocument({ documentId: "text-leader-wave11-property" });
  document.textStyles.push({ id: "TXT", name: "TXT", fontFamily: "Arial", widthFactor: 0.85, obliqueAngleRad: 0 });
  return document;
}

describe("F-057 MTEXT deterministic property ratchet", () => {
  it("round-trips 256 seeded Unicode code-point corpora through character wrapping", () => {
    const alphabet = ["A", "õ", "中", "😀", "🚀", "Ω", "ß"];
    const document = fixture();
    for (let seed = 1; seed <= 256; seed += 1) {
      const length = 1 + seed % 31;
      const text = Array.from({ length }, (_, index) => alphabet[(seed * 17 + index * 13) % alphabet.length]!).join("");
      const entity = createMText(document, { handle: `U${seed}`, layerId: "0", position: { x: seed * 0.25, y: -seed }, text, height: 0.5 + seed % 7, width: 0.25 + seed % 19, styleId: "TXT", wrapMode: "character" });
      const lines = deriveMTextLayout(document, entity).map((line) => line.text);
      expect(lines.join("")).toBe(text);
      expect(lines.every((line) => Array.from(line).join("") === line)).toBe(true);
    }
  });

  it("keeps all surviving paragraph ids stable across deterministic grow/shrink edits", () => {
    const document = fixture();
    document.entities.push(createMText(document, { handle: "T1", layerId: "0", position: { x: 0, y: 0 }, text: "A\nB", height: 2, width: 20, paragraphs: [{ id: "A-ID", alignment: "left" }, { id: "B-ID", alignment: "right" }] }));
    for (let count = 1; count <= 32; count += 1) {
      const change = editMText(document, "T1", { text: Array.from({ length: count }, (_, index) => `R${index + 1}`).join("\n") });
      if (change.type !== "put") throw new Error("Expected MTEXT put change.");
      const ids = readMTextContract(change.entity)?.paragraphs.map((paragraph) => paragraph.id);
      expect(ids?.[0]).toBe("A-ID");
      if (count > 1) expect(ids?.[1]).toBe("B-ID");
    }
  });
});
