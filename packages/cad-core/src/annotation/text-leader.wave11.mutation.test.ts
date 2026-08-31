import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../document.js";
import { readLeaderContract, readMTextContract } from "./contracts.js";
import { createLeader, createMLeader, createMText, deriveMTextLayout, editLeader, editMText } from "./text.js";

describe("F-057..F-060 text/leader mutation ratchet", () => {
  it("kills code-unit wrapping and paragraph-id regeneration mutants", () => {
    const document = createEmptyDocument({ documentId: "text-wave11-mutation" });
    const entity = createMText(document, { handle: "T1", layerId: "0", position: { x: 0, y: 0 }, text: "😀🚀", height: 2, width: 1, wrapMode: "character", paragraphs: [{ id: "KEEP", alignment: "center" }] });
    expect(deriveMTextLayout(document, entity).map((line) => line.text)).toEqual(["😀", "🚀"]);
    document.entities.push(entity);
    const change = editMText(document, "T1", { text: "😀🚀\nLisa" });
    if (change.type !== "put") throw new Error("Expected MTEXT put change.");
    expect(readMTextContract(change.entity)?.paragraphs).toEqual([{ id: "KEEP", alignment: "center" }, { id: "P1", alignment: "left" }]);
  });

  it("kills preserved-style and preserved-association null-edit mutants", () => {
    const document = createEmptyDocument({ documentId: "leader-wave11-mutation" });
    document.textStyles.push({ id: "TXT", name: "TXT", fontFamily: "Arial", widthFactor: 1, obliqueAngleRad: 0 });
    document.entities.push({ kind: "line", handle: "10", layerId: "0", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    const leader = createLeader(document, { handle: "L1", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }], text: "L", textStyleId: "TXT", anchor: { handle: "10", feature: "end", fallback: { x: 10, y: 0 } } });
    const mleader = createMLeader(document, { handle: "ML1", layerId: "0", vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }], text: "M", textPosition: { x: 22, y: 0 }, styleId: "MLS", textStyleId: "TXT", textHeight: 2.5, anchor: { handle: "10", feature: "start", fallback: { x: 0, y: 0 } } });
    document.entities.push(leader, mleader);
    const first = editLeader(document, "L1", { textStyleId: null, anchor: null });
    const second = editLeader(document, "ML1", { textStyleId: null, anchor: null });
    if (first.type !== "put" || second.type !== "put") throw new Error("Expected leader put changes.");
    expect(readLeaderContract(first.entity)).toMatchObject({ associative: false, content: { textHeight: 2.5 } });
    expect(readLeaderContract(first.entity)).not.toHaveProperty("anchor");
    expect(readLeaderContract(first.entity)).not.toHaveProperty("content.textStyleId");
    expect(readLeaderContract(second.entity)).toMatchObject({ kind: "mleader", styleId: "MLS", associative: false });
    expect(readLeaderContract(second.entity)).not.toHaveProperty("textStyleId");
  });
});
